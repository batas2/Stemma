using System.Text.Json;
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
        if (engine is null) return new UndoState(false, false, null, null, 0, 0);
        var stack = engine.Undo;
        return new UndoState(stack.CanUndo, stack.CanRedo, stack.PeekUndoDescription(), stack.PeekRedoDescription(),
            stack.UndoDepth, stack.RedoDepth);
    }

    public Task Subscribe() => Task.CompletedTask;

    /// <summary>
    /// The presenter's console (F-019): the window presenting says where it is, the console says what
    /// to do, and the hub passes each on to every other window. Relayed rather than sent window to
    /// window, so the console works from any window or browser on this machine — the desktop shell's
    /// projector window with the system browser on the laptop included. Nothing is kept or written.
    /// </summary>
    public Task PresenterState(JsonElement state) => Clients.Others.SendAsync("PresenterState", state);

    public Task PresenterCommand(JsonElement command) => Clients.Others.SendAsync("PresenterCommand", command);
}

/// <param name="UndoDepth">How many steps the engine can undo. The client groups several operations
/// into one step (a paste) and checks this before undoing them together: a depth it does not expect
/// means someone else edited since, and it undoes one step instead of guessing.</param>
public sealed record UndoState(bool CanUndo, bool CanRedo, string? UndoDescription, string? RedoDescription,
    int UndoDepth, int RedoDepth);
