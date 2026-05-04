using Microsoft.AspNetCore.SignalR;
using Verso.Engine.Operations;
using Verso.Web.Services;

namespace Verso.Web.Hubs;

public sealed class WorkspaceHub(EngineHost host) : Hub
{
    private readonly EngineHost _host = host;

    public async Task<OperationResult> ApplyOperation(OperationBase op)
    {
        var result = await _host.ApplyAsync(op, Context.ConnectionAborted);
        if (result is OperationApplied applied)
        {
            await Clients.All.SendAsync("OperationApplied", applied);
        }
        return result;
    }

    public async Task<OperationResult?> Undo()
    {
        var engine = _host.Engine;
        if (engine is null) return null;
        var result = await engine.UndoAsync($"undo_{Guid.NewGuid():N}", Context.ConnectionAborted);
        if (result is OperationApplied applied)
        {
            await Clients.All.SendAsync("OperationApplied", applied);
        }
        return result;
    }

    public async Task<OperationResult?> Redo()
    {
        var engine = _host.Engine;
        if (engine is null) return null;
        var result = await engine.RedoAsync($"redo_{Guid.NewGuid():N}", Context.ConnectionAborted);
        if (result is OperationApplied applied)
        {
            await Clients.All.SendAsync("OperationApplied", applied);
        }
        return result;
    }

    public UndoState GetUndoState()
    {
        var engine = _host.Engine;
        if (engine is null) return new UndoState(false, false, null, null);
        var stack = engine.Undo;
        return new UndoState(stack.CanUndo, stack.CanRedo, stack.PeekUndoDescription(), stack.PeekRedoDescription());
    }

    public Task Subscribe() => Task.CompletedTask;
}

public sealed record UndoState(bool CanUndo, bool CanRedo, string? UndoDescription, string? RedoDescription);
