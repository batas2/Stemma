using Microsoft.AspNetCore.SignalR;
using Stemma.Engine.Operations;
using Stemma.Web.Diagnostics;
using Stemma.Web.Services;

namespace Stemma.Web.Hubs;

public sealed class WorkspaceHub(EngineHost host, ILogger<WorkspaceHub> log) : Hub
{
    private readonly EngineHost _host = host;

    /// <summary>
    /// The correlation id arrives as an argument because a SignalR invocation has no headers. Opening
    /// a scope with it here is what makes AC5 hold across the hop: every engine record produced while
    /// this runs carries the same id as the HTTP calls around it.
    /// </summary>
    public async Task<OperationResult> ApplyOperation(OperationBase op, string? correlationId = null)
    {
        using var scope = log.BeginScope(new Dictionary<string, object>
        {
            ["correlationId"] = correlationId ?? "(none)",
            ["opId"] = op.OpId,
        });
        WebLog.HubOperationReceived(log, op.GetType().Name, op.OpId);

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
