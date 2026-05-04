using Verso.Engine.Models;
using Verso.Engine.Operations;
using Verso.Engine.Workspace;

namespace Verso.Web.Services;

public sealed class EngineHost : IAsyncDisposable
{
    private VersoEngine? _engine;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<WorkspaceModel> OpenAsync(string rootPath, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_engine is not null) await _engine.DisposeAsync();
            _engine = await VersoEngine.OpenAsync(rootPath, ct);
            return _engine.Model;
        }
        finally
        {
            _gate.Release();
        }
    }

    public WorkspaceModel? Snapshot() => _engine?.Model;

    public async Task<OperationResult> ApplyAsync(OperationBase op, CancellationToken ct = default)
    {
        if (_engine is null) return new OperationFailed(op.OpId, "WorkspaceNotOpen", "Open a workspace first");
        return await _engine.ApplyAsync(op, ct);
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
