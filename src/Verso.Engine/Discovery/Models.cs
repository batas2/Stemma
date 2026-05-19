namespace Verso.Engine.Discovery;

/// <summary>The full output of a discovery run. Regenerable from source; never authoritative.</summary>
public sealed record DiscoveredModel(
    string RootPath,
    DateTime ComputedAt,
    IReadOnlyList<DiscoveredProject> Projects,
    IReadOnlyList<DiscoveredNamespace> Namespaces,
    IReadOnlyList<DiscoveredModule> Modules,
    IReadOnlyList<DependencyEdge> Edges);

public sealed record DiscoveredProject(
    string Id,
    string Name,
    string FilePath,
    string TargetFramework,
    IReadOnlyList<string> ProjectReferences,
    IReadOnlyList<string> PackageReferences,
    IReadOnlyList<string> TypeIds);

public sealed record DiscoveredNamespace(
    string Fqn,
    string ProjectId,
    IReadOnlyList<string> TypeIds);

/// <summary>A proposed module — the unit Verso renders on the canvas.</summary>
public sealed record DiscoveredModule(
    string Id,
    string Name,
    DiscoveredModuleSource Source,
    string ProjectId,
    string? NamespacePrefix,
    string? FolderPath,
    IReadOnlyList<string> TypeIds,
    double Confidence,
    string Rationale);

public enum DiscoveredModuleSource { Project, Namespace, Folder }

/// <summary>An edge between two types (or a type and a phantom external endpoint).</summary>
public sealed record DependencyEdge(
    string FromTypeId,
    string ToTypeId,
    EdgeKind Kind,
    EdgeTransport Transport,
    EdgeDirection Direction,
    EdgePattern Pattern,
    string? Contract,
    string? ContractAssembly,
    string? Endpoint,
    bool External,
    EdgeEvidence Evidence);

public enum EdgeKind
{
    // Structural
    Inherits, Implements, ReferencesType, Instantiates, Calls,
    // In-process flow (MediatR / Mediator)
    PublishesInprocNotification, HandlesInprocNotification, SendsInprocRequest, HandlesInprocRequest,
    // Cross-process async
    EmitsEventAsync, ConsumesEventAsync, SendsCommandAsync, HandlesCommandAsync,
    // Cross-process sync
    HttpCall, GrpcCall, GrpcHandler, SignalRCall, SignalRHandler,
    // Infra
    ReadsConfig, Injects, DbContext,
}

public enum EdgeTransport
{
    InProcess, Mediatr, MassTransit, Wolverine, NServiceBus,
    AzureServiceBus, AzureEventGrid, RabbitMq, Kafka,
    Grpc, SignalR, Http, EfCore, Dapper, Na,
}

public enum EdgeDirection { Outbound, Inbound, Na }
public enum EdgePattern { Event, Command, Query, Na }

public sealed record EdgeEvidence(string FilePath, int StartLine, int EndLine);

// ---------------- Metrics ----------------

public sealed record WorkspaceMetrics(
    string RootPath,
    DateTime ComputedAt,
    IReadOnlyList<ModuleMetric> Modules,
    IReadOnlyList<NamespaceMetric> Namespaces,
    IReadOnlyList<ProjectMetric> Projects,
    double WorkspaceAvgDistanceFromMainSequence);

public sealed record ModuleMetric(
    string ModuleId,
    string ModuleName,
    int TypeCount,
    int Ca,
    int Ce,
    double Instability,
    double Abstractness,
    double DistanceFromMainSequence,
    double RelationalCohesion,
    int InternalEdges,
    int ExternalEdges,
    IReadOnlyDictionary<string, int> EdgeKindHistogram);

public sealed record NamespaceMetric(
    string Fqn, int TypeCount,
    int Ca, int Ce, double Instability, double Abstractness, double DistanceFromMainSequence);

public sealed record ProjectMetric(
    string ProjectId, string Name, int TypeCount,
    int Ca, int Ce, double Instability, double Abstractness, double DistanceFromMainSequence);

// ---------------- View recommendations ----------------

public sealed record RecommendedView(
    string Id,
    string Name,
    string Source,             // recommender id (e.g. "namespace-tree", "instability-hotspots")
    string Audience,           // "architect" | "engineer" | "executive" | ...
    string Intent,             // ≤ 200 chars
    IReadOnlyList<string> ModuleIds,
    IReadOnlyList<EdgeKind> EdgeKinds,
    string Layout,             // c4Context | moduleMap | dependencyGraph | hierarchy | forceDirected
    double ValueScore,         // 0..1
    string Rationale);

// ---------------- Configuration sidecar ----------------

public sealed record DiscoveryConfig(
    IReadOnlyList<string>? Transports,
    IReadOnlyList<DiscoveryConfigExternalSystem>? ExternalSystems,
    IReadOnlyList<DiscoveryConfigEndpointOverride>? EndpointOverrides,
    IReadOnlyList<DiscoveryConfigModulePin>? ModulePins,
    int? NamespaceDepth);

public sealed record DiscoveryConfigExternalSystem(string Assembly, string Label);
public sealed record DiscoveryConfigEndpointOverride(string Method, string Endpoint);
public sealed record DiscoveryConfigModulePin(string FolderOrNamespace, string ModuleName);
