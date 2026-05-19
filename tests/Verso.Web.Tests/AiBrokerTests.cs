using FluentAssertions;
using Verso.Engine.Discovery;
using Verso.Engine.Models;
using Verso.Web.Services;
using Xunit;

namespace Verso.Web.Tests;

public class AiBrokerTests
{
    [Fact]
    public async Task Returns_transport_unavailable_when_transport_not_ready()
    {
        var broker = new AiBroker(new StubTransport(available: false));
        var result = await broker.AnalyseModuleAsync(
            new AnalyseModuleRequest("dmod_001", "summarise"),
            EmptyWorkspace(), EmptyBundle(), CancellationToken.None);
        result.Ok.Should().BeFalse();
        result.ErrorCode.Should().Be("TransportUnavailable");
    }

    [Fact]
    public async Task Returns_module_not_found_when_module_id_is_unknown()
    {
        var broker = new AiBroker(new StubTransport(available: true, response: new ClaudeResponse("{}")));
        var result = await broker.AnalyseModuleAsync(
            new AnalyseModuleRequest("missing", "summarise"),
            EmptyWorkspace(), EmptyBundle(), CancellationToken.None);
        result.Ok.Should().BeFalse();
        result.ErrorCode.Should().Be("ModuleNotFound");
    }

    [Fact]
    public async Task Returns_first_json_block_from_response_text()
    {
        var canned = "Here is the analysis:\n{\"module_id\":\"dmod_001\",\"summary\":\"hi\"}\nEnd.";
        var broker = new AiBroker(new StubTransport(available: true, response: new ClaudeResponse(canned)));
        var bundle = BundleWithModule("dmod_001", "Test");
        var result = await broker.AnalyseModuleAsync(
            new AnalyseModuleRequest("dmod_001", "summarise"),
            EmptyWorkspace(), bundle, CancellationToken.None);
        result.Ok.Should().BeTrue();
        result.ResultJson.Should().Contain("\"module_id\":\"dmod_001\"");
    }

    [Fact]
    public void ExtractFirstJson_handles_no_json_gracefully()
    {
        AiBroker.ExtractFirstJson("just prose, nothing else").Should().BeNull();
        AiBroker.ExtractFirstJson("text {\"a\":1} more").Should().Be("{\"a\":1}");
    }

    [Fact]
    public async Task Transport_failure_surfaces_as_error_result()
    {
        var broker = new AiBroker(new ThrowingTransport());
        var bundle = BundleWithModule("dmod_001", "Test");
        var result = await broker.AnalyseModuleAsync(
            new AnalyseModuleRequest("dmod_001", "discover-structure"),
            EmptyWorkspace(), bundle, CancellationToken.None);
        result.Ok.Should().BeFalse();
        result.ErrorCode.Should().Be("TransportFailure");
    }

    [Fact]
    public void TransportLabel_reports_chosen_transport()
    {
        new AiBroker(new StubTransport(label: "cli")).TransportLabel.Should().Be("cli");
        new AiBroker(new StubTransport(label: "http")).TransportLabel.Should().Be("http");
    }

    private static WorkspaceModel EmptyWorkspace() =>
        new("/tmp/test-ws", new List<ProjectModel>());

    private static DiscoveryBundle EmptyBundle() => new(
        new DiscoveredModel("/tmp/test-ws", DateTime.UtcNow,
            Array.Empty<DiscoveredProject>(), Array.Empty<DiscoveredNamespace>(),
            Array.Empty<DiscoveredModule>(), Array.Empty<DependencyEdge>()),
        new WorkspaceMetrics("/tmp/test-ws", DateTime.UtcNow,
            Array.Empty<ModuleMetric>(), Array.Empty<NamespaceMetric>(),
            Array.Empty<ProjectMetric>(), 0),
        Array.Empty<RecommendedView>());

    private static DiscoveryBundle BundleWithModule(string id, string name) => new(
        new DiscoveredModel("/tmp/test-ws", DateTime.UtcNow,
            Array.Empty<DiscoveredProject>(), Array.Empty<DiscoveredNamespace>(),
            new[] { new DiscoveredModule(id, name, DiscoveredModuleSource.Project,
                "proj_test", null, null, Array.Empty<string>(), 1.0, "test") },
            Array.Empty<DependencyEdge>()),
        new WorkspaceMetrics("/tmp/test-ws", DateTime.UtcNow,
            Array.Empty<ModuleMetric>(), Array.Empty<NamespaceMetric>(),
            Array.Empty<ProjectMetric>(), 0),
        Array.Empty<RecommendedView>());

    private sealed class StubTransport(bool available = true, ClaudeResponse? response = null, string label = "stub") : IClaudeTransport
    {
        public string Label { get; } = label;
        public bool IsAvailable { get; } = available;
        public Task<ClaudeResponse> SendAsync(ClaudeRequest request, CancellationToken ct) =>
            Task.FromResult(response ?? new ClaudeResponse("{}"));
    }

    private sealed class ThrowingTransport : IClaudeTransport
    {
        public string Label => "throwing";
        public bool IsAvailable => true;
        public Task<ClaudeResponse> SendAsync(ClaudeRequest request, CancellationToken ct) =>
            throw new HttpRequestException("simulated network failure");
    }
}
