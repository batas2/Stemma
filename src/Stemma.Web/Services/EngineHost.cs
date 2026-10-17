using Microsoft.AspNetCore.SignalR;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Models;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Stemma.Web.Diagnostics;
using Stemma.Web.Hubs;

namespace Stemma.Web.Services;

public sealed class EngineHost : IAsyncDisposable
{
    private StemmaEngine? _engine;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly IHubContext<WorkspaceHub>? _hub;
    private readonly ILoggerFactory _loggerFactory;
    private readonly ILogger<EngineHost> _log;

    public EngineHost(IHubContext<WorkspaceHub>? hub = null, ILoggerFactory? loggerFactory = null)
    {
        _hub = hub;
        // The engine takes an ILogger by injection and defaults to NullLogger, so an EngineHost
        // constructed without a factory — as the tests do — still works and simply says nothing.
        _loggerFactory = loggerFactory ?? Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance;
        _log = _loggerFactory.CreateLogger<EngineHost>();
    }

    public async Task<WorkspaceModel> OpenAsync(string rootPath, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_engine is not null) await _engine.DisposeAsync();
            _engine = await StemmaEngine.OpenAsync(rootPath, ct, _loggerFactory.CreateLogger<StemmaEngine>());
            _engine.ExternalChange += async path =>
            {
                if (_hub is null) return;
                try
                {
                    await _hub.Clients.All.SendAsync("ExternalChange", new { path });
                }
                catch (Exception e)
                {
                    // The client resyncs on its next reload, so this is degraded rather than failed —
                    // but a panel that never refreshed is exactly the symptom nobody could explain.
                    WebLog.BroadcastFailed(_log, "ExternalChange", e);
                }
            };
            _engine.SidecarChanged += async () =>
            {
                if (_hub is null) return;
                try
                {
                    await _hub.Clients.All.SendAsync("SidecarChanged");
                }
                catch (Exception e)
                {
                    WebLog.BroadcastFailed(_log, "SidecarChanged", e);
                }
            };
            _engine.StartWatching();
            RecentWorkspaces.Touch(rootPath);
            return _engine.Model;
        }
        finally
        {
            _gate.Release();
        }
    }

    public StemmaEngine? Engine => _engine;

    public WorkspaceModel? Snapshot() => _engine?.Model;

    public async Task<OperationResult> ApplyAsync(OperationBase op, CancellationToken ct = default)
    {
        if (_engine is null) return new OperationFailed(op.OpId, "WorkspaceNotOpen", "Open a workspace first");
        return await _engine.ApplyAsync(op, ct);
    }

    public async Task<ArchModel?> ReadArchAsync(CancellationToken ct = default)
    {
        if (_engine is null) return null;
        return await _engine.ReadArchModelAsync(ct);
    }

    public async Task CloseAsync()
    {
        await _gate.WaitAsync();
        try
        {
            if (_engine is not null)
            {
                await _engine.DisposeAsync();
                _engine = null;
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_engine is not null) await _engine.DisposeAsync();
    }
}
