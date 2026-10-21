using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Stemma.Web.Services;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The host holds one workspace at a time and swaps it when another is opened. It used to close the
/// open one first and then load the next, with the load tied to the request: a load that failed, or a
/// request that went away while MSBuild was still loading, left the host holding a workspace it had
/// already closed. The snapshot still answered, the model read nothing, and every edit went to an
/// engine whose files were gone. Closing did not wait for an edit in flight either.
/// </summary>
public sealed class EngineHostTests : IAsyncLifetime
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-enginehost-{Guid.NewGuid():N}")).FullName;

    /// <summary>Loads the test can hold open, as a large MSBuild load is held open by MSBuild.</summary>
    private sealed class Loads
    {
        public bool Hold;
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    private readonly Loads _loads = new();
    private EngineHost _host = null!;

    public Task InitializeAsync()
    {
        _host = new EngineHost(hub: null, loggerFactory: null, recents: null, load: async (root, ct) =>
        {
            if (_loads.Hold)
            {
                _loads.Started.TrySetResult();
                await _loads.Release.Task.WaitAsync(ct);
            }
            return await StemmaEngine.OpenAsync(root, ct);
        });
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _loads.Release.TrySetResult();
        await _host.DisposeAsync();
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>A model-only workspace holding one module, <paramref name="id"/>.</summary>
    private string Model(string name, string id)
    {
        var root = Path.Combine(_dir, name);
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        File.WriteAllText(Path.Combine(root, "Architecture", "Architecture.cs"), $$"""
            using Stemma.Model;
            namespace {{name}};
            public static class Architecture
            {
                public static Model Build()
                {
                    var a = new Module("{{id}}", "A");
                    return Model.Of(a);
                }
            }
            """);
        return root;
    }

    private async Task<IReadOnlyList<string>> ElementIdsAsync() =>
        (await _host.ReadArchAsync())?.Elements.Select(e => e.Id).ToList() ?? [];

    private static AddElementOp AddModule(string name) => new($"op_{Guid.NewGuid():N}", ArchElementKind.Module, name);

    private static async Task Eventually(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("the condition never held");
            await Task.Delay(10);
        }
    }

    [Fact]
    public async Task A_workspace_that_fails_to_open_leaves_the_open_one_working()
    {
        var first = Model("First", "mod_first");
        await _host.OpenAsync(first);
        var nothing = Directory.CreateDirectory(Path.Combine(_dir, "Nothing")).FullName;

        var failed = () => _host.OpenAsync(nothing);

        await failed.Should().ThrowAsync<Exception>();
        _host.Snapshot()!.RootPath.Should().Be(first);
        (await ElementIdsAsync()).Should().Equal("mod_first");
        (await _host.ApplyAsync(AddModule("Second"))).Should().BeOfType<OperationApplied>(
            "the workspace that is still shown is the one an edit goes to, and it has to be open");
    }

    [Fact]
    public async Task While_another_workspace_loads_the_open_one_still_answers_and_takes_edits()
    {
        var first = Model("First", "mod_first");
        var second = Model("Second", "mod_second");
        await _host.OpenAsync(first);
        _loads.Hold = true;

        var opening = _host.OpenAsync(second);
        await _loads.Started.Task;

        (await ElementIdsAsync()).Should().Equal("mod_first");
        (await _host.ApplyAsync(AddModule("Third"))).Should().BeOfType<OperationApplied>();
        opening.IsCompleted.Should().BeFalse();

        _loads.Release.SetResult();
        await opening;
        (await ElementIdsAsync()).Should().Equal("mod_second");
    }

    [Fact]
    public async Task An_open_whose_requester_went_away_still_finishes()
    {
        // The audit's case: a client that timed out while MSBuild was loading. The load was cancelled
        // with the request and the host was left holding the workspace it had closed to make room.
        var first = Model("First", "mod_first");
        var second = Model("Second", "mod_second");
        await _host.OpenAsync(first);
        _loads.Hold = true;
        using var request = new CancellationTokenSource();

        var opening = _host.OpenAsync(second, request.Token);
        await _loads.Started.Task;
        await request.CancelAsync();
        _loads.Release.SetResult();

        await opening;
        _host.Snapshot()!.RootPath.Should().Be(second);
        (await ElementIdsAsync()).Should().Equal("mod_second");
    }

    [Fact]
    public async Task Closing_waits_for_work_in_flight_and_starts_none()
    {
        var first = Model("First", "mod_first");
        await _host.OpenAsync(first);
        var inFlight = _host.Use()!;

        var closing = _host.CloseAsync();
        await Task.Delay(100);

        closing.IsCompleted.Should().BeFalse("an edit in flight finishes before its workspace is closed under it");
        _host.Use().Should().BeNull("nothing new starts on a workspace that is closing");
        (await inFlight.Engine.ReadArchModelAsync())!.Elements.Select(e => e.Id).Should().Equal("mod_first");

        inFlight.Dispose();
        await closing.WaitAsync(TimeSpan.FromSeconds(10));
        _host.Snapshot().Should().BeNull();
    }

    [Fact]
    public async Task Opening_another_sends_new_work_to_it_and_closes_the_old_one_after_its_work_is_done()
    {
        var first = Model("First", "mod_first");
        var second = Model("Second", "mod_second");
        await _host.OpenAsync(first);
        var inFlight = _host.Use()!;

        var opening = _host.OpenAsync(second);
        await Eventually(() => _host.Snapshot()?.RootPath == second);

        (await ElementIdsAsync()).Should().Equal("mod_second");
        (await inFlight.Engine.ReadArchModelAsync())!.Elements.Select(e => e.Id).Should().Equal("mod_first");
        opening.IsCompleted.Should().BeFalse();

        inFlight.Dispose();
        await opening.WaitAsync(TimeSpan.FromSeconds(10));
    }
}
