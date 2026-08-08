using System.Text.Json;
using Microsoft.Playwright;

namespace Stemma.Cli;

/// <summary>What one theme/format combination produced.</summary>
public sealed record RenderedFile(string Path, string Theme, string Format, int NodeCount, int Width, int Height);

/// <summary>
/// Drives the canvas's own render mode and captures what it draws.
///
/// This deliberately does not know how a node looks. It opens the page the app renders, waits for
/// the page to say it has settled, and captures the result — so the picture in a post and the
/// picture on screen come from one implementation. Everything this file knows about is plumbing:
/// ports, waiting, cropping, and files.
/// </summary>
public sealed class DiagramRenderer(string baseUrl) : IAsyncDisposable
{
    private IPlaywright? _pw;
    private IBrowser? _browser;

    private async Task<IBrowser> BrowserAsync()
    {
        if (_browser is not null) return _browser;
        _pw = await Playwright.CreateAsync();
        // The system Chrome, rather than a downloaded build: one less thing to install, and the
        // engine the author previews in anyway.
        _browser = await _pw.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Channel = "chrome",
            Headless = true,
            Args = ["--hide-scrollbars", "--force-color-profile=srgb"],
        });
        return _browser;
    }

    private static string BuildUrl(string baseUrl, RenderOptions o, string theme)
    {
        var q = new List<string>
        {
            "render=1",
            $"view={Uri.EscapeDataString(o.View)}",
            $"profile={Uri.EscapeDataString(o.Profile)}",
            $"theme={Uri.EscapeDataString(theme)}",
        };
        if (!string.IsNullOrWhiteSpace(o.Palette)) q.Add($"palette={Uri.EscapeDataString(o.Palette)}");
        return $"{baseUrl}/?{string.Join('&', q)}";
    }

    public async Task<RenderedFile> RenderAsync(RenderOptions o, string theme, string format, CancellationToken ct = default)
    {
        var browser = await BrowserAsync();
        await using var context = await browser.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = new ViewportSize { Width = 1800, Height = 1200 },
            DeviceScaleFactor = o.Scale,
            ColorScheme = theme == "dark" ? ColorScheme.Dark : ColorScheme.Light,
        });
        // The app reads its own theme preference before React mounts; set it where it looks.
        await context.AddInitScriptAsync($"try{{localStorage.setItem('stemma.theme','{theme}')}}catch(e){{}}");

        var page = await context.NewPageAsync();
        var consoleErrors = new List<string>();
        page.PageError += (_, e) => consoleErrors.Add(e);

        await page.GotoAsync(BuildUrl(baseUrl, o, theme), new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded });

        var state = await WaitForSettledAsync(page, o.TimeoutSeconds, ct);
        if (state == "error")
        {
            var why = await page.GetAttributeAsync("html", "data-stemma-render-error") ?? "unknown";
            throw new InvalidOperationException($"the canvas reported an error: {why}");
        }
        if (state == "empty")
            throw new InvalidOperationException($"view '{o.View}' resolved to no elements — nothing to draw");
        if (state != "ready")
            throw new TimeoutException(
                $"the canvas did not settle within {o.TimeoutSeconds}s (last state: {state})"
                + (consoleErrors.Count > 0 ? $"; page errors: {string.Join(" | ", consoleErrors.Take(3))}" : ""));

        var nodeCount = await page.Locator(".react-flow__node").CountAsync();
        var box = await ContentBoxAsync(page, o.Pad);
        var target = o.OutputFor(theme, format);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);

        if (format == "svg")
        {
            var svg = await page.EvaluateAsync<string?>(SerializeSvgScript)
                ?? throw new InvalidOperationException("the canvas produced no SVG layer to serialise");
            await File.WriteAllTextAsync(target, svg, ct);
        }
        else
        {
            await page.ScreenshotAsync(new PageScreenshotOptions
            {
                Path = target,
                Type = ScreenshotType.Png,
                OmitBackground = o.Transparent,
                Clip = box,
            });
        }

        return new RenderedFile(target, theme, format, nodeCount, (int)box.Width, (int)box.Height);
    }

    /// <summary>
    /// Wait for the page's published state rather than for a fixed number of milliseconds.
    ///
    /// `loading` is the only value worth waiting through; `ready`, `empty` and `error` are all
    /// final, and distinguishing the last two from a timeout is the point of the contract.
    /// </summary>
    private static async Task<string> WaitForSettledAsync(IPage page, int timeoutSeconds, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        var last = "loading";
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            last = await page.GetAttributeAsync("html", "data-stemma-render") ?? "loading";
            if (last is "ready" or "empty" or "error") return last;
            await Task.Delay(80, ct);
        }
        return last;
    }

    /// <summary>
    /// Crop to what the drawing occupies, using the rectangle the page published when it placed the
    /// content.
    ///
    /// Measuring the DOM instead was the obvious approach and it is not reproducible: element rects
    /// include bezier overshoot on the edge layer, which moves by tens of pixels between runs, so
    /// the same view came out at three different heights. The page derives this box from the same
    /// numbers it used to set the transform, which makes the crop a function of the model and the
    /// layout rather than of what the browser happened to have painted.
    /// </summary>
    private static async Task<Clip> ContentBoxAsync(IPage page, int pad)
    {
        var raw = await page.EvaluateAsync<JsonElement>(ContentBoundsScript);
        double x = raw.GetProperty("x").GetDouble(), y = raw.GetProperty("y").GetDouble();
        double w = raw.GetProperty("width").GetDouble(), h = raw.GetProperty("height").GetDouble();
        var vw = raw.GetProperty("vw").GetDouble();
        var vh = raw.GetProperty("vh").GetDouble();

        var left = Math.Max(0, x - pad);
        var top = Math.Max(0, y - pad);
        return new Clip
        {
            X = (float)left,
            Y = (float)top,
            Width = (float)Math.Max(1, Math.Min(vw, x + w + pad) - left),
            Height = (float)Math.Max(1, Math.Min(vh, y + h + pad) - top),
        };
    }

    private const string ContentBoundsScript = """
        () => {
          const raw = document.documentElement.dataset.stemmaRenderBox;
          if (raw) {
            const b = JSON.parse(raw);
            return { x: b.x, y: b.y, width: b.width, height: b.height, vw: innerWidth, vh: innerHeight };
          }
          // Only reachable if the page reported ready without placing content, which would be a bug
          // in the readiness contract rather than a state to paper over — fall back to the viewport
          // so the failure is a visibly wrong picture rather than a crash.
          return { x: 0, y: 0, width: innerWidth, height: innerHeight, vw: innerWidth, vh: innerHeight };
        }
        """;

    /// <summary>
    /// Serialise the live edge layer as standalone SVG.
    ///
    /// Honest about what this is: React Flow draws edges as real SVG, so those come out as true
    /// vector, while nodes are HTML and are not represented here. It is useful for reworking edge
    /// routing in a vector editor; it is not yet a substitute for the PNG. Emitting nodes as SVG
    /// primitives from the same component tree is the remaining half.
    /// </summary>
    private const string SerializeSvgScript = """
        () => {
          const svg = document.querySelector('.react-flow__edges');
          if (!svg) return null;
          const clone = svg.cloneNode(true);
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          return new XMLSerializer().serializeToString(clone);
        }
        """;

    public async ValueTask DisposeAsync()
    {
        if (_browser is not null) await _browser.CloseAsync();
        _pw?.Dispose();
    }
}
