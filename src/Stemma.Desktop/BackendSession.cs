using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Stemma.Web;

namespace Stemma.Desktop;

/// <summary>
/// Kestrel, inside this process, owned by this window.
///
/// The shell does not supervise a child process — it <em>is</em> the backend (ADR-0017). That is
/// what makes F-002 AC2 true by construction rather than by cleanup: when the window closes the
/// process ends, so there is no orphan left holding a port and no reclaim logic to get wrong.
/// Binding port 0 finishes the job: two windows cannot collide because neither owns a fixed port.
/// </summary>
public sealed class BackendSession : IAsyncDisposable
{
    private readonly WebApplication? _app;
    private readonly string? _problem;
    private bool _started;

    private BackendSession(WebApplication? app, string? problem)
    {
        _app = app;
        _problem = problem;
    }

    /// <summary>
    /// Compose the host this window will own. Deliberately total — anything wrong is carried to
    /// <see cref="StartAsync"/> and surfaces in the window, because a shell that dies before it has
    /// drawn anything is indistinguishable from one that never launched.
    /// </summary>
    public static BackendSession Create(IReadOnlyList<string> hostArgs)
    {
        var args = new List<string>(hostArgs);
        string? problem = null;

        // Without this the content root is the shell's own directory, so `wwwroot` resolves to
        // nothing and the window loads a 404 — the API works perfectly, which makes it a confusing
        // thing to debug from the outside.
        if (!args.Contains("--contentRoot"))
        {
            var contentRoot = StemmaWebHost.FindContentRoot();
            if (contentRoot is null)
                problem = "The Stemma front end has not been built. Run `npm run build` in "
                          + "src/Stemma.Web.Client, or `./run.sh --prod` once, then launch again.";
            else
                args.AddRange(["--contentRoot", contentRoot]);
        }

        args.AddRange(["--urls", StemmaWebHost.DynamicLoopbackUrl]);
        try
        {
            return new BackendSession(StemmaWebHost.Build([.. args]), problem);
        }
        catch (Exception e)
        {
            // Composing the host can fail before it ever binds — an unwritable log directory is the
            // realistic one. Carried rather than thrown, so the reason appears in the window instead
            // of on a terminal the user may not have.
            return new BackendSession(null, problem ?? e.Message);
        }
    }

    /// <summary>Where this build writes its log, for the failure surface.</summary>
    public static string LogDirectory => Stemma.Web.Diagnostics.StemmaLogging.DefaultLogDirectory;

    /// <summary>
    /// Bind, and open the requested workspace if there is one. Returns the address the window should
    /// navigate to.
    /// </summary>
    public async Task<string> StartAsync(string? workspacePath, CancellationToken ct = default)
    {
        if (_problem is not null) throw new InvalidOperationException(_problem);
        if (_app is null) throw new InvalidOperationException("the Stemma backend was never composed");

        await _app.StartAsync(ct);
        _started = true;
        var url = StemmaWebHost.BoundUrl(_app);

        // Opened over HTTP rather than by reaching into the engine, so that `--workspace` behaves
        // exactly like the same action taken in the app — one code path, one set of failures.
        if (workspacePath is not null) await OpenWorkspaceAsync(url, workspacePath, ct);

        return url;
    }

    private static async Task OpenWorkspaceAsync(string baseUrl, string rootPath, CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
        var body = new StringContent(
            JsonSerializer.Serialize(new { rootPath }), Encoding.UTF8, "application/json");
        try
        {
            using var response = await http.PostAsync($"{baseUrl}/api/workspace/open", body, ct);
            if (response.IsSuccessStatusCode) return;
            Console.Error.WriteLine(
                $"stemma-desktop: could not open '{rootPath}': {await response.Content.ReadAsStringAsync(ct)}");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            Console.Error.WriteLine($"stemma-desktop: could not open '{rootPath}': {e.Message}");
        }
        // Deliberately not fatal. A bad `--workspace` should land the user in the app's own empty
        // state, where they can pick another one — not in a dead window.
    }

    public async ValueTask DisposeAsync()
    {
        if (_app is null) return;
        try
        {
            if (_started) await _app.StopAsync();
        }
        catch (Exception) { /* shutting down anyway */ }
        await _app.DisposeAsync();
    }
}
