using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace Stemma.Cli;

/// <summary>
/// A Stemma backend that exists for the duration of one render, then goes away.
///
/// The engine holds exactly one workspace per process and `/api/workspace/open` swaps it, so
/// rendering against a shared server would mutate whatever the person at the keyboard had open and
/// would serialise every render behind one another. The alternatives were a multi-workspace host —
/// a broad refactor of the web layer plus an eviction policy for Roslyn workspaces, in exchange for
/// saving seconds on a job that runs a handful of times a week — or feeding the page directly and
/// giving the canvas a second way to be fed. A short-lived process is the least clever of the three
/// and the only one that changes no shared state: it also contains crashes and leaves the running
/// app alone.
/// </summary>
public sealed class HostProcess : IAsyncDisposable
{
    private readonly Process _process;
    public string BaseUrl { get; }

    private HostProcess(Process process, string baseUrl)
    {
        _process = process;
        BaseUrl = baseUrl;
    }

    /// <summary>
    /// Ask the OS for a free port by binding and immediately releasing one.
    ///
    /// There is a race here in principle — something else could take the port in the gap — and it
    /// is the standard one every tool of this shape lives with. Kestrel binding to :0 would avoid
    /// it, but then the assigned port has to be scraped back out of the host's stdout, which trades
    /// a rare race for a permanent dependency on log formatting.
    /// </summary>
    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    public static async Task<HostProcess> StartAsync(string hostDll, string contentRoot, TimeSpan timeout, CancellationToken ct = default)
    {
        var port = FreePort();
        var baseUrl = $"http://127.0.0.1:{port}";

        var process = Process.Start(StartInfo(hostDll, contentRoot, baseUrl))
            ?? throw new InvalidOperationException("could not start the Stemma host");
        // Drained so a chatty host cannot fill its pipe buffer and deadlock.
        _ = Task.Run(async () => { try { await process.StandardOutput.ReadToEndAsync(ct); } catch { /* going away */ } }, ct);
        _ = Task.Run(async () => { try { await process.StandardError.ReadToEndAsync(ct); } catch { /* going away */ } }, ct);

        var host = new HostProcess(process, baseUrl);
        try
        {
            await host.WaitUntilServingAsync(timeout, ct);
        }
        catch
        {
            await host.DisposeAsync();
            throw;
        }
        return host;
    }

    /// <summary>How the host is started: on <paramref name="baseUrl"/>, serving <paramref name="contentRoot"/>.</summary>
    public static ProcessStartInfo StartInfo(string hostDll, string contentRoot, string baseUrl)
    {
        var psi = SiblingProgram.StartInfo(hostDll);
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.ArgumentList.Add("--urls");
        psi.ArgumentList.Add(baseUrl);
        // Without this the content root is the *caller's* working directory, so `wwwroot` resolves
        // to wherever the render happened to be run from and the SPA 404s. The symptom is an opaque
        // navigation failure, so it is worth being explicit rather than relying on the default.
        psi.ArgumentList.Add("--contentRoot");
        psi.ArgumentList.Add(contentRoot);
        // The workspace is opened for a render nobody watches; it is not one the person opened, and
        // has no place at the top of their recent list.
        psi.ArgumentList.Add("--recents");
        psi.ArgumentList.Add("off");
        psi.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
        return psi;
    }

    private async Task WaitUntilServingAsync(TimeSpan timeout, CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (_process.HasExited)
                throw new InvalidOperationException($"the Stemma host exited with code {_process.ExitCode} before it began serving");
            try
            {
                // Any answer means Kestrel is up; 404 for an unopened workspace is a fine answer.
                using var r = await http.GetAsync($"{BaseUrl}/api/workspace/snapshot", ct);
                return;
            }
            catch (HttpRequestException) { await Task.Delay(120, ct); }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { await Task.Delay(120, ct); }
        }
        throw new TimeoutException($"the Stemma host did not start serving on {BaseUrl} within {timeout.TotalSeconds:0}s");
    }

    /// <summary>Open a workspace on this host. Done over HTTP rather than in the page so that a
    /// failure to open is reported as a failure to open, not as a render that timed out.</summary>
    public async Task OpenWorkspaceAsync(string rootPath, CancellationToken ct = default)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
        var body = new StringContent(
            $$"""{"rootPath":{{System.Text.Json.JsonSerializer.Serialize(rootPath)}}}""",
            System.Text.Encoding.UTF8, "application/json");
        using var r = await http.PostAsync($"{BaseUrl}/api/workspace/open", body, ct);
        if (!r.IsSuccessStatusCode)
            throw new InvalidOperationException($"could not open workspace '{rootPath}': {(int)r.StatusCode} {await r.Content.ReadAsStringAsync(ct)}");
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
                await _process.WaitForExitAsync();
            }
        }
        catch { /* already gone */ }
        _process.Dispose();
    }
}
