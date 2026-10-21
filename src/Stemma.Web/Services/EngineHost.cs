using Microsoft.AspNetCore.SignalR;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Models;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Stemma.Web.Diagnostics;
using Stemma.Web.Hubs;

namespace Stemma.Web.Services;

/// <summary>
/// The one workspace this process has open, and the only way to reach it.
///
/// Opening another loads it first and swaps it in only once it has loaded, so a load that fails — or
/// one the requester stopped waiting for — leaves the open workspace open, rather than a closed one in
/// its place. The engine being replaced is closed once nothing is still using it: everything that uses
/// the engine does so through a <see cref="Lease"/>, and closing waits for the leases out.
/// </summary>
public sealed class EngineHost : IAsyncDisposable
{
    /// <summary>One opened engine and who is using it. Retired once another has replaced it.</summary>
    internal sealed class Slot(StemmaEngine engine)
    {
        public StemmaEngine Engine { get; } = engine;
        public int Users;
        public bool Retired;
        public TaskCompletionSource Drained { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    /// <summary>
    /// The engine for as long as this is held: it is not closed under the holder, even if another
    /// workspace is opened meanwhile. Dispose it when the work is done.
    /// </summary>
    public sealed class Lease : IDisposable
    {
        private readonly EngineHost _host;
        private Slot? _slot;

        internal Lease(EngineHost host, Slot slot)
        {
            _host = host;
            _slot = slot;
        }

        public StemmaEngine Engine => (_slot ?? throw new ObjectDisposedException(nameof(Lease))).Engine;

        public void Dispose()
        {
            var slot = Interlocked.Exchange(ref _slot, null);
            if (slot is not null) _host.Release(slot);
        }
    }

    private readonly object _sync = new();
    private Slot? _current;
    /// <summary>Serialises opening and closing; using the open engine never waits on it.</summary>
    private readonly SemaphoreSlim _gate = new(1, 1);
    /// <summary>Cancelled when the host shuts down — the only thing that stops a load once begun.</summary>
    private readonly CancellationTokenSource _stopping = new();
    private readonly IHubContext<WorkspaceHub>? _hub;
    private readonly ILoggerFactory _loggerFactory;
    private readonly ILogger<EngineHost> _log;
    private readonly Func<string, CancellationToken, Task<StemmaEngine>> _load;

    /// <param name="recents">Where an opened workspace is remembered; null to remember nothing, as a
    /// host started for a headless render does.</param>
    public EngineHost(IHubContext<WorkspaceHub>? hub = null, ILoggerFactory? loggerFactory = null, RecentWorkspaces? recents = null)
        : this(hub, loggerFactory, recents, load: null)
    {
    }

    /// <param name="load">How a workspace is loaded; the engine's own loader unless a test needs to
    /// hold a load open to see what happens meanwhile.</param>
    internal EngineHost(IHubContext<WorkspaceHub>? hub, ILoggerFactory? loggerFactory, RecentWorkspaces? recents,
        Func<string, CancellationToken, Task<StemmaEngine>>? load)
    {
        _hub = hub;
        Recents = recents;
        // The engine takes an ILogger by injection and defaults to NullLogger, so an EngineHost
        // constructed without a factory — as the tests do — still works and simply says nothing.
        _loggerFactory = loggerFactory ?? Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance;
        _log = _loggerFactory.CreateLogger<EngineHost>();
        _load = load ?? ((root, ct) => StemmaEngine.OpenAsync(root, ct, _loggerFactory.CreateLogger<StemmaEngine>()));
    }

    /// <summary>
    /// Open <paramref name="rootPath"/> in place of whatever is open. <paramref name="ct"/> cancels only
    /// the wait to begin: a load once begun is finished, because the requester going away — a closed
    /// tab, a client timeout — is no reason to leave the host between two workspaces. If the load
    /// fails, the workspace that was open stays open and the error is the caller's to report.
    /// </summary>
    public async Task<WorkspaceModel> OpenAsync(string rootPath, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var engine = await _load(rootPath, _stopping.Token);
            try
            {
                Subscribe(engine);
                engine.StartWatching();
            }
            catch
            {
                await engine.DisposeAsync();
                throw;
            }

            await RetireAsync(Swap(new Slot(engine)));
            if (Recents is not null) await Recents.TouchAsync(rootPath);
            return engine.Model;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>The recent list this host adds to, or null when it keeps none.</summary>
    public RecentWorkspaces? Recents { get; }

    /// <summary>The open engine, held until the lease is disposed; null when nothing is open.</summary>
    public Lease? Use()
    {
        lock (_sync)
        {
            if (_current is null) return null;
            _current.Users++;
            return new Lease(this, _current);
        }
    }

    /// <summary>What is open, as it was last read. A record, so it is safe to read without a lease.</summary>
    public WorkspaceModel? Snapshot() => Volatile.Read(ref _current)?.Engine.Model;

    public async Task<OperationResult> ApplyAsync(OperationBase op, CancellationToken ct = default)
    {
        using var lease = Use();
        if (lease is null) return new OperationFailed(op.OpId, "WorkspaceNotOpen", "Open a workspace first");
        return await lease.Engine.ApplyAsync(op, ct);
    }

    public async Task<ArchModel?> ReadArchAsync(CancellationToken ct = default)
    {
        using var lease = Use();
        if (lease is null) return null;
        return await lease.Engine.ReadArchModelAsync(ct);
    }

    /// <summary>Close what is open, once whatever is using it has finished.</summary>
    public async Task CloseAsync()
    {
        await _gate.WaitAsync();
        try
        {
            await RetireAsync(Swap(null));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        // A load still running at shutdown is abandoned; the engine it would have produced has
        // nowhere to go.
        await _stopping.CancelAsync();
        await CloseAsync();
        _stopping.Dispose();
    }

    private Slot? Swap(Slot? next)
    {
        lock (_sync)
        {
            var previous = _current;
            Volatile.Write(ref _current, next);
            if (previous is null) return null;
            previous.Retired = true;
            if (previous.Users == 0) previous.Drained.TrySetResult();
            return previous;
        }
    }

    private void Release(Slot slot)
    {
        lock (_sync)
        {
            slot.Users--;
            if (slot.Retired && slot.Users == 0) slot.Drained.TrySetResult();
        }
    }

    /// <summary>Close a replaced engine once the last lease on it is let go.</summary>
    private static async Task RetireAsync(Slot? slot)
    {
        if (slot is null) return;
        await slot.Drained.Task;
        await slot.Engine.DisposeAsync();
    }

    private bool IsCurrent(StemmaEngine engine) => ReferenceEquals(Volatile.Read(ref _current)?.Engine, engine);

    /// <summary>
    /// Pass the engine's news on to every window. A replaced engine may still report a change while
    /// the last work on it finishes; that news is about a workspace no window shows any more.
    /// </summary>
    private void Subscribe(StemmaEngine engine)
    {
        engine.ExternalChange += path => _ = BroadcastAsync(engine, "ExternalChange", new { path });
        engine.SidecarChanged += () => _ = BroadcastAsync(engine, "SidecarChanged", null);
        engine.CommentsChanged += () => _ = BroadcastAsync(engine, "CommentsChanged", null);
    }

    private async Task BroadcastAsync(StemmaEngine from, string message, object? payload)
    {
        if (_hub is null || !IsCurrent(from)) return;
        try
        {
            if (payload is null) await _hub.Clients.All.SendAsync(message);
            else await _hub.Clients.All.SendAsync(message, payload);
        }
        catch (Exception e)
        {
            // The client resyncs on its next reload, so this is degraded rather than failed — but a
            // panel that never refreshed is exactly the symptom nobody could explain.
            WebLog.BroadcastFailed(_log, message, e);
        }
    }
}
