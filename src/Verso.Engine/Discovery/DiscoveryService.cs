using Microsoft.CodeAnalysis;
using Verso.Engine.Models;

namespace Verso.Engine.Discovery;

/// <summary>
/// One-shot orchestration: run discovery → run metrics → run recommender, persist sidecars,
/// return the bundle. Engine layer; no I/O outside the workspace root.
/// </summary>
public sealed class DiscoveryService
{
    public async Task<DiscoveryBundle> RunAsync(
        WorkspaceModel workspace,
        Solution? solution,
        CancellationToken ct = default)
    {
        var config = DiscoverySidecars.ReadConfig(workspace.RootPath);
        var runner = new DiscoveryRunner();
        var discovered = await runner.RunAsync(workspace, solution, config, ct);

        var metricsCalc = new MetricsCalculator();
        var metrics = metricsCalc.Compute(workspace, discovered);

        var recommender = new ViewRecommender();
        var recommendations = recommender.Recommend(discovered, metrics);

        DiscoverySidecars.WriteDiscovered(workspace.RootPath, discovered);
        DiscoverySidecars.WriteMetrics(workspace.RootPath, metrics);

        return new DiscoveryBundle(discovered, metrics, recommendations);
    }

    public DiscoveryBundle? ReadCached(string rootPath)
    {
        var d = DiscoverySidecars.ReadDiscovered(rootPath);
        var m = DiscoverySidecars.ReadMetrics(rootPath);
        if (d is null || m is null) return null;
        var recs = new ViewRecommender().Recommend(d, m);
        return new DiscoveryBundle(d, m, recs);
    }
}

public sealed record DiscoveryBundle(
    DiscoveredModel Discovered,
    WorkspaceMetrics Metrics,
    IReadOnlyList<RecommendedView> Recommendations);
