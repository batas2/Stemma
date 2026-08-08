namespace Stemma.Cli;

/// <summary>
/// Everything `stemma render` needs, parsed from the command line.
///
/// Parsing lives in its own type, away from the process and browser plumbing, because it is the
/// part with rules worth testing: what is required, what is clamped, and which combinations are
/// contradictions rather than merely unusual.
/// </summary>
public sealed record RenderOptions
{
    public required string Workspace { get; init; }
    public required string View { get; init; }
    public required string Output { get; init; }

    public string Profile { get; init; } = "publication";
    public string? Palette { get; init; }
    /// <summary>Themes to render. More than one writes `name-light.png` / `name-dark.png` pairs.</summary>
    public IReadOnlyList<string> Themes { get; init; } = ["light"];
    public IReadOnlyList<string> Formats { get; init; } = ["png"];
    public bool Transparent { get; init; } = true;
    public int Scale { get; init; } = 2;
    public int Pad { get; init; } = 24;
    public int TimeoutSeconds { get; init; } = 60;

    public const int ScaleMin = 1;
    public const int ScaleMax = 4;

    public static readonly string[] KnownFormats = ["png", "svg"];
    public static readonly string[] KnownThemes = ["light", "dark"];
    public static readonly string[] KnownProfiles = ["app", "publication"];

    public const string Usage = """
        stemma render — turn a model and a view into an image, with no browser of your own open.

          stemma render --workspace <path> --view <id> --out <file> [options]

        Required
          --workspace <path>   Workspace root (the folder holding Architecture/ and stemma.layout.json)
          --view <id>          Custom view id or name, or a lens: moduleMap | dependencyGraph
          --out <file>         Output path. With more than one theme or format the name is suffixed.

        Options
          --profile <name>     publication (default) | app
          --palette <name>     dual-theme (default) | print | slide
          --theme <list>       light (default) | dark | light,dark
          --format <list>      png (default) | svg | png,svg
          --opaque             Bake the page background in. Default is transparent.
          --scale <1-4>        Device pixel multiplier. Default 2.
          --pad <px>           Padding around the content bounds. Default 24.
          --timeout <seconds>  How long to wait for the canvas to settle. Default 60.
        """;

    /// <summary>Parsed options, or an error explaining what the command line got wrong.</summary>
    public sealed record ParseResult(RenderOptions? Options, string? Error)
    {
        public bool Ok => Options is not null;
    }

    private static List<string> SplitList(string raw) =>
        raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
           .Select(s => s.ToLowerInvariant()).Distinct().ToList();

    public static ParseResult Parse(IReadOnlyList<string> args)
    {
        string? workspace = null, view = null, output = null, palette = null;
        var profile = "publication";
        List<string> themes = ["light"], formats = ["png"];
        var transparent = true;
        int scale = 2, pad = 24, timeout = 60;

        string? Need(int i, string flag) => i + 1 < args.Count ? args[i + 1] : null;

        for (var i = 0; i < args.Count; i++)
        {
            var a = args[i];
            switch (a)
            {
                case "--workspace": workspace = Need(i, a); i++; break;
                case "--view": view = Need(i, a); i++; break;
                case "--out": output = Need(i, a); i++; break;
                case "--profile": profile = Need(i, a)?.ToLowerInvariant() ?? profile; i++; break;
                case "--palette": palette = Need(i, a); i++; break;
                case "--theme": themes = SplitList(Need(i, a) ?? ""); i++; break;
                case "--format": formats = SplitList(Need(i, a) ?? ""); i++; break;
                case "--opaque": transparent = false; break;
                case "--scale":
                    if (!int.TryParse(Need(i, a), out scale)) return new(null, "--scale needs a whole number");
                    i++; break;
                case "--pad":
                    if (!int.TryParse(Need(i, a), out pad)) return new(null, "--pad needs a whole number");
                    i++; break;
                case "--timeout":
                    if (!int.TryParse(Need(i, a), out timeout)) return new(null, "--timeout needs a whole number of seconds");
                    i++; break;
                default:
                    if (a.StartsWith("--", StringComparison.Ordinal)) return new(null, $"unknown option '{a}'");
                    break;
            }
        }

        if (string.IsNullOrWhiteSpace(workspace)) return new(null, "--workspace is required");
        if (string.IsNullOrWhiteSpace(view)) return new(null, "--view is required");
        if (string.IsNullOrWhiteSpace(output)) return new(null, "--out is required");

        if (!KnownProfiles.Contains(profile)) return new(null, $"unknown profile '{profile}' (known: {string.Join(", ", KnownProfiles)})");
        if (themes.Count == 0) themes = ["light"];
        if (formats.Count == 0) formats = ["png"];
        foreach (var t in themes) if (!KnownThemes.Contains(t)) return new(null, $"unknown theme '{t}' (known: {string.Join(", ", KnownThemes)})");
        foreach (var f in formats) if (!KnownFormats.Contains(f)) return new(null, $"unknown format '{f}' (known: {string.Join(", ", KnownFormats)})");

        // Clamped rather than rejected: a scale outside the range is a typo, not an argument to
        // have, and failing the whole render over it helps nobody.
        scale = Math.Clamp(scale, ScaleMin, ScaleMax);
        pad = Math.Max(0, pad);
        timeout = Math.Clamp(timeout, 5, 600);

        return new(new RenderOptions
        {
            Workspace = Path.GetFullPath(workspace!),
            View = view!,
            Output = Path.GetFullPath(output!),
            Profile = profile,
            Palette = palette,
            Themes = themes,
            Formats = formats,
            Transparent = transparent,
            Scale = scale,
            Pad = pad,
            TimeoutSeconds = timeout,
        }, null);
    }

    /// <summary>
    /// Where one theme/format combination is written.
    ///
    /// A single theme and format keeps the name exactly as given — a caller that asked for
    /// `who-do-you-ask.png` should get that file, not `who-do-you-ask-light.png`. Ask for two and
    /// the theme becomes a suffix, which is the pairing the `&lt;picture&gt;` convention expects.
    /// </summary>
    public string OutputFor(string theme, string format)
    {
        var dir = Path.GetDirectoryName(Output) ?? ".";
        var stem = Path.GetFileNameWithoutExtension(Output);
        var suffix = Themes.Count > 1 ? $"-{theme}" : "";
        return Path.Combine(dir, $"{stem}{suffix}.{format}");
    }
}
