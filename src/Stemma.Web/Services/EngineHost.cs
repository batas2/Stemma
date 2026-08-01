using Microsoft.AspNetCore.SignalR;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Models;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Stemma.Web.Hubs;

namespace Stemma.Web.Services;

public sealed class EngineHost : IAsyncDisposable
{
    private StemmaEngine? _engine;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly IHubContext<WorkspaceHub>? _hub;

    public EngineHost(IHubContext<WorkspaceHub>? hub = null) { _hub = hub; }

    public async Task<WorkspaceModel> OpenAsync(string rootPath, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_engine is not null) await _engine.DisposeAsync();
            _engine = await StemmaEngine.OpenAsync(rootPath, ct);
            _engine.ExternalChange += async path =>
            {
                if (_hub is null) return;
                try { await _hub.Clients.All.SendAsync("ExternalChange", new { path }); } catch { }
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
