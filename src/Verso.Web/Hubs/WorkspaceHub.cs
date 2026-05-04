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

    public Task Subscribe() => Task.CompletedTask;
}
