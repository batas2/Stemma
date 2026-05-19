using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Verso.Engine.Models;
using TypeKind = Verso.Engine.Models.TypeKind;

namespace Verso.Engine.Discovery;

/// <summary>
/// Walks every type declaration in the workspace and emits typed <see cref="DependencyEdge"/>s
/// covering the structural, in-process flow, async, sync, and infrastructure categories from
/// Epic 06 Track B. Cross-process targets that resolve to assemblies outside the workspace are
/// rendered as <c>external:&lt;assembly&gt;:&lt;type&gt;</c> phantom nodes.
/// </summary>
public sealed class DependencyExtractor
{
    public async Task<IReadOnlyList<DependencyEdge>> ExtractAsync(
        WorkspaceModel workspace,
        Solution? solution,
        IReadOnlyList<DiscoveredModule> modules,
        DiscoveryConfig? config,
        CancellationToken ct = default)
    {
        var edges = new List<DependencyEdge>();
        var typeIndex = workspace.AllTypes.ToDictionary(t => t.Id);
        var typeBySimpleName = workspace.AllTypes
            .GroupBy(t => t.Name)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Always include structural edges from the in-memory WorkspaceModel — these don't need a
        // SemanticModel because BaseTypes are already pre-extracted by WorkspaceLoader.
        foreach (var t in workspace.AllTypes)
        {
            foreach (var bt in t.BaseTypes)
            {
                var resolved = ResolveTypeRef(bt, typeBySimpleName);
                var kind = ClassifyBase(resolved, bt);
                edges.Add(new DependencyEdge(
                    FromTypeId: t.Id,
                    ToTypeId: resolved?.Id ?? PhantomFor(bt.FullyQualifiedName),
                    Kind: kind,
                    Transport: EdgeTransport.InProcess,
                    Direction: EdgeDirection.Outbound,
                    Pattern: EdgePattern.Na,
                    Contract: null,
                    ContractAssembly: null,
                    Endpoint: null,
                    External: resolved is null,
                    Evidence: new EdgeEvidence(t.FilePath, 1, 1)));
            }
        }

        // Roslyn semantic walk for behaviour edges. If we don't have a Solution (e.g. a snapshot
        // built from a synthetic in-memory model in tests), skip the semantic pass.
        if (solution is null) return edges;

        foreach (var project in solution.Projects)
        {
            var compilation = await project.GetCompilationAsync(ct);
            if (compilation is null) continue;
            foreach (var doc in project.Documents)
            {
                if (!doc.SupportsSyntaxTree) continue;
                var tree = await doc.GetSyntaxTreeAsync(ct);
                if (tree is null) continue;
                var path = doc.FilePath;
                if (path is null) continue;
                if (path.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase)) continue;
                var semantic = compilation.GetSemanticModel(tree);
                var root = await tree.GetRootAsync(ct);

                foreach (var typeDecl in root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
                {
                    var ownerSym = semantic.GetDeclaredSymbol(typeDecl);
                    if (ownerSym is null) continue;
                    var ownerId = MakeTypeId(ownerSym);

                    // Constructor injection — every parameter type
                    if (typeDecl is TypeDeclarationSyntax tds)
                    {
                        foreach (var ctor in tds.Members.OfType<ConstructorDeclarationSyntax>())
                        {
                            foreach (var p in ctor.ParameterList.Parameters)
                            {
                                var paramSym = semantic.GetTypeInfo(p.Type!, ct).Type;
                                if (paramSym is null) continue;
                                var (toId, external) = ResolveSymbol(paramSym, typeIndex);
                                edges.Add(MakeEdge(ownerId, toId, EdgeKind.Injects, EdgeTransport.InProcess,
                                    EdgeDirection.Outbound, EdgePattern.Na, null, null, null, external,
                                    Evidence(path, p)));
                            }
                        }
                    }

                    // Walk descendant invocations + object creation + base list interfaces
                    foreach (var node in typeDecl.DescendantNodes())
                    {
                        ct.ThrowIfCancellationRequested();
                        switch (node)
                        {
                            case InvocationExpressionSyntax inv:
                                ClassifyInvocation(inv, semantic, ownerId, typeIndex, edges, path, ct);
                                break;
                            case ObjectCreationExpressionSyntax oce:
                                {
                                    var typeInfo = semantic.GetTypeInfo(oce, ct).Type;
                                    if (typeInfo is null) break;
                                    var (toId, ext) = ResolveSymbol(typeInfo, typeIndex);
                                    edges.Add(MakeEdge(ownerId, toId, EdgeKind.Instantiates, EdgeTransport.InProcess,
                                        EdgeDirection.Outbound, EdgePattern.Na, null, null, null, ext,
                                        Evidence(path, oce)));
                                    break;
                                }
                        }
                    }

                    // Implements/handles — from base list, classify generic interfaces
                    if (typeDecl.BaseList is { } bl)
                    {
                        foreach (var bt in bl.Types)
                        {
                            var sym = semantic.GetTypeInfo(bt.Type, ct).Type;
                            if (sym is not INamedTypeSymbol named) continue;
                            ClassifyHandlerInterface(named, ownerId, typeIndex, edges, path, bt);
                        }
                    }

                    // Properties referencing types
                    if (typeDecl is TypeDeclarationSyntax tds2)
                    {
                        foreach (var prop in tds2.Members.OfType<PropertyDeclarationSyntax>())
                        {
                            var sym = semantic.GetTypeInfo(prop.Type, ct).Type;
                            if (sym is null) continue;
                            var (toId, ext) = ResolveSymbol(sym, typeIndex);
                            // Skip primitives + the 'object' fallback type
                            if (sym.SpecialType != SpecialType.None) continue;
                            edges.Add(MakeEdge(ownerId, toId, EdgeKind.ReferencesType, EdgeTransport.InProcess,
                                EdgeDirection.Outbound, EdgePattern.Na, null, null, null, ext,
                                Evidence(path, prop)));
                        }
                    }
                }
            }
        }

        // De-duplicate exact equal edges (kind + ownerType + targetType)
        return edges
            .GroupBy(e => (e.FromTypeId, e.ToTypeId, e.Kind, e.Transport))
            .Select(g => g.First())
            .ToList();
    }

    private static void ClassifyInvocation(
        InvocationExpressionSyntax inv,
        SemanticModel semantic,
        string ownerId,
        IReadOnlyDictionary<string, TypeModel> typeIndex,
        List<DependencyEdge> edges,
        string path,
        CancellationToken ct)
    {
        var symbolInfo = semantic.GetSymbolInfo(inv, ct);
        var sym = symbolInfo.Symbol ?? symbolInfo.CandidateSymbols.FirstOrDefault();
        if (sym is not IMethodSymbol method) return;

        var receiverType = method.ContainingType;
        var receiverFqn = receiverType?.ToDisplayString() ?? string.Empty;

        // ---- MediatR / Mediator.NET in-process flow ----
        if (receiverFqn is "MediatR.IMediator" or "MediatR.IPublisher")
        {
            EmitFlowEdge(method, inv, semantic, EdgeKind.PublishesInprocNotification,
                EdgeTransport.Mediatr, EdgePattern.Event, ownerId, typeIndex, edges, path, ct);
            return;
        }
        if (receiverFqn is "MediatR.ISender" || (receiverFqn == "MediatR.IMediator" && method.Name == "Send"))
        {
            EmitFlowEdge(method, inv, semantic, EdgeKind.SendsInprocRequest,
                EdgeTransport.Mediatr, EdgePattern.Command, ownerId, typeIndex, edges, path, ct);
            return;
        }

        // ---- MassTransit ----
        if (receiverFqn is "MassTransit.IPublishEndpoint" or "MassTransit.IBus" && method.Name == "Publish")
        {
            EmitFlowEdge(method, inv, semantic, EdgeKind.EmitsEventAsync,
                EdgeTransport.MassTransit, EdgePattern.Event, ownerId, typeIndex, edges, path, ct,
                external: true);
            return;
        }
        if (receiverFqn == "MassTransit.ISendEndpoint" && method.Name == "Send")
        {
            EmitFlowEdge(method, inv, semantic, EdgeKind.SendsCommandAsync,
                EdgeTransport.MassTransit, EdgePattern.Command, ownerId, typeIndex, edges, path, ct,
                external: true);
            return;
        }

        // ---- NServiceBus ----
        if (receiverFqn.StartsWith("NServiceBus."))
        {
            if (method.Name == "Publish")
            {
                EmitFlowEdge(method, inv, semantic, EdgeKind.EmitsEventAsync,
                    EdgeTransport.NServiceBus, EdgePattern.Event, ownerId, typeIndex, edges, path, ct,
                    external: true);
                return;
            }
            if (method.Name is "Send" or "Reply")
            {
                EmitFlowEdge(method, inv, semantic, EdgeKind.SendsCommandAsync,
                    EdgeTransport.NServiceBus, EdgePattern.Command, ownerId, typeIndex, edges, path, ct,
                    external: true);
                return;
            }
        }

        // ---- Wolverine ----
        if (receiverFqn.StartsWith("Wolverine."))
        {
            if (method.Name == "PublishAsync")
            {
                EmitFlowEdge(method, inv, semantic, EdgeKind.EmitsEventAsync,
                    EdgeTransport.Wolverine, EdgePattern.Event, ownerId, typeIndex, edges, path, ct,
                    external: true);
                return;
            }
            if (method.Name == "SendAsync" || method.Name == "InvokeAsync")
            {
                EmitFlowEdge(method, inv, semantic, EdgeKind.SendsCommandAsync,
                    EdgeTransport.Wolverine, EdgePattern.Command, ownerId, typeIndex, edges, path, ct,
                    external: true);
                return;
            }
        }

        // ---- Azure Service Bus ----
        if (receiverFqn == "Azure.Messaging.ServiceBus.ServiceBusSender" &&
            (method.Name == "SendMessageAsync" || method.Name == "SendMessagesAsync"))
        {
            var endpoint = ExtractServiceBusEndpoint(inv, semantic, ct);
            edges.Add(MakeEdge(ownerId, PhantomFor(endpoint ?? "azure.servicebus"),
                EdgeKind.EmitsEventAsync, EdgeTransport.AzureServiceBus,
                EdgeDirection.Outbound, EdgePattern.Event, null, "Azure.Messaging.ServiceBus", endpoint,
                external: true, Evidence(path, inv)));
            return;
        }
        if (receiverFqn == "Azure.Messaging.EventGrid.EventGridPublisherClient" &&
            (method.Name == "SendEventAsync" || method.Name == "SendEventsAsync"))
        {
            edges.Add(MakeEdge(ownerId, PhantomFor("azure.eventgrid"),
                EdgeKind.EmitsEventAsync, EdgeTransport.AzureEventGrid,
                EdgeDirection.Outbound, EdgePattern.Event, null, "Azure.Messaging.EventGrid", null,
                external: true, Evidence(path, inv)));
            return;
        }

        // ---- Configuration ----
        if ((receiverFqn == "Microsoft.Extensions.Configuration.IConfiguration"
             || receiverFqn.StartsWith("Microsoft.Extensions.Configuration"))
            && (method.Name == "GetSection" || method.Name == "GetValue"))
        {
            var key = ExtractFirstStringLiteral(inv);
            edges.Add(MakeEdge(ownerId, PhantomFor("config:" + (key ?? "*")),
                EdgeKind.ReadsConfig, EdgeTransport.Na,
                EdgeDirection.Outbound, EdgePattern.Na, null, null, key,
                external: true, Evidence(path, inv)));
            return;
        }

        // ---- HTTP outbound ----
        if (receiverFqn == "System.Net.Http.HttpClient" &&
            method.Name is "GetAsync" or "PostAsync" or "PutAsync" or "DeleteAsync" or "SendAsync"
                          or "PatchAsync")
        {
            var url = ExtractFirstStringLiteral(inv);
            edges.Add(MakeEdge(ownerId, PhantomFor("http:" + (url ?? "*")),
                EdgeKind.HttpCall, EdgeTransport.Http,
                EdgeDirection.Outbound, EdgePattern.Query, null, "System.Net.Http", url,
                external: true, Evidence(path, inv)));
            return;
        }

        // ---- DbContext use (any method on a type derived from DbContext) ----
        if (receiverType is not null && InheritsFrom(receiverType, "Microsoft.EntityFrameworkCore.DbContext"))
        {
            edges.Add(MakeEdge(ownerId, MakeTypeId(receiverType), EdgeKind.DbContext, EdgeTransport.EfCore,
                EdgeDirection.Outbound, EdgePattern.Na, null, "Microsoft.EntityFrameworkCore", null,
                external: false, Evidence(path, inv)));
            return;
        }

        // ---- Generic intra-workspace call ----
        if (receiverType is not null)
        {
            var (toId, ext) = ResolveSymbol(receiverType, typeIndex);
            edges.Add(MakeEdge(ownerId, toId, EdgeKind.Calls, EdgeTransport.InProcess,
                EdgeDirection.Outbound, EdgePattern.Na, null, null, null, ext,
                Evidence(path, inv)));
        }
    }

    private static void EmitFlowEdge(
        IMethodSymbol method,
        InvocationExpressionSyntax inv,
        SemanticModel semantic,
        EdgeKind kind,
        EdgeTransport transport,
        EdgePattern pattern,
        string ownerId,
        IReadOnlyDictionary<string, TypeModel> typeIndex,
        List<DependencyEdge> edges,
        string path,
        CancellationToken ct,
        bool external = false)
    {
        // Try generic argument first (e.g. Publish<E>(...))
        ITypeSymbol? contractSym = method.TypeArguments.FirstOrDefault();
        // Otherwise the first concrete argument's type
        if (contractSym is null && inv.ArgumentList.Arguments.Count > 0)
        {
            contractSym = semantic.GetTypeInfo(inv.ArgumentList.Arguments[0].Expression, ct).Type;
        }
        if (contractSym is null) return;

        var (toId, ext) = ResolveSymbol(contractSym, typeIndex);
        var contract = contractSym.ToDisplayString();
        var contractAsm = contractSym.ContainingAssembly?.Name;
        var phantom = external || ext;
        edges.Add(MakeEdge(ownerId,
            phantom ? PhantomFor(contract, contractAsm) : toId,
            kind, transport, EdgeDirection.Outbound, pattern, contract, contractAsm, null,
            external: phantom,
            Evidence(path, inv)));
    }

    private static void ClassifyHandlerInterface(
        INamedTypeSymbol named,
        string ownerId,
        IReadOnlyDictionary<string, TypeModel> typeIndex,
        List<DependencyEdge> edges,
        string path,
        BaseTypeSyntax bt)
    {
        var fqn = named.OriginalDefinition.ToDisplayString();
        EdgeKind? kind = fqn switch
        {
            "MediatR.INotificationHandler<TNotification>" => EdgeKind.HandlesInprocNotification,
            "MediatR.IRequestHandler<TRequest, TResponse>" => EdgeKind.HandlesInprocRequest,
            "MediatR.IRequestHandler<TRequest>" => EdgeKind.HandlesInprocRequest,
            "MassTransit.IConsumer<TMessage>" => EdgeKind.ConsumesEventAsync,
            "NServiceBus.IHandleMessages<T>" => EdgeKind.HandlesCommandAsync,
            "Wolverine.IHandler<T>" => EdgeKind.ConsumesEventAsync,
            _ => null,
        };
        if (kind is null) return;

        var contractSym = named.TypeArguments.FirstOrDefault();
        if (contractSym is null) return;
        var (toId, ext) = ResolveSymbol(contractSym, typeIndex);
        var transport = fqn.StartsWith("MediatR.") ? EdgeTransport.Mediatr
                       : fqn.StartsWith("MassTransit.") ? EdgeTransport.MassTransit
                       : fqn.StartsWith("NServiceBus.") ? EdgeTransport.NServiceBus
                       : fqn.StartsWith("Wolverine.") ? EdgeTransport.Wolverine
                       : EdgeTransport.InProcess;
        var pattern = kind == EdgeKind.HandlesInprocRequest || kind == EdgeKind.HandlesCommandAsync
            ? EdgePattern.Command : EdgePattern.Event;
        // For a *handler*, the "from" is the contract (event/command) and the "to" is the owning type.
        var fromId = ext ? PhantomFor(contractSym.ToDisplayString(), contractSym.ContainingAssembly?.Name) : toId;
        edges.Add(MakeEdge(fromId, ownerId, kind.Value, transport, EdgeDirection.Inbound, pattern,
            contractSym.ToDisplayString(), contractSym.ContainingAssembly?.Name, null,
            external: ext, Evidence(path, bt)));
    }

    private static EdgeKind ClassifyBase(TypeModel? resolved, TypeRef bt)
    {
        // If the resolved type is an interface, this is `implements`; otherwise `inherits`.
        if (resolved is { Kind: TypeKind.Interface }) return EdgeKind.Implements;
        // Interfaces conventionally start with 'I' followed by an uppercase letter.
        var simple = bt.FullyQualifiedName.Split('.').Last().Split('<')[0];
        if (simple.Length > 1 && simple[0] == 'I' && char.IsUpper(simple[1])) return EdgeKind.Implements;
        return EdgeKind.Inherits;
    }

    private static (string Id, bool External) ResolveSymbol(ITypeSymbol sym, IReadOnlyDictionary<string, TypeModel> typeIndex)
    {
        var id = MakeTypeId(sym);
        return typeIndex.ContainsKey(id) ? (id, false) : (PhantomFor(id, sym.ContainingAssembly?.Name), true);
    }

    private static TypeModel? ResolveTypeRef(TypeRef bt, IReadOnlyDictionary<string, List<TypeModel>> bySimple)
    {
        var simple = bt.FullyQualifiedName.Split('.').Last().Split('<')[0];
        if (!bySimple.TryGetValue(simple, out var list)) return null;
        return list.FirstOrDefault();
    }

    private static string MakeTypeId(ITypeSymbol sym)
    {
        if (sym is INamedTypeSymbol named && named.IsGenericType)
        {
            return named.OriginalDefinition.ToDisplayString();
        }
        return sym.ToDisplayString();
    }

    private static bool InheritsFrom(ITypeSymbol sym, string baseTypeFqn)
    {
        for (var cur = sym; cur is not null; cur = cur.BaseType)
        {
            if (cur.ToDisplayString() == baseTypeFqn) return true;
        }
        return false;
    }

    private static string? ExtractServiceBusEndpoint(InvocationExpressionSyntax inv, SemanticModel sm, CancellationToken ct)
    {
        // Heuristic: look for a `new ServiceBusSender(client, "topic-name")` upstream — too
        // expensive in v1. We accept the literal-arg-1 fallback instead.
        return ExtractFirstStringLiteral(inv);
    }

    private static string? ExtractFirstStringLiteral(InvocationExpressionSyntax inv)
    {
        var first = inv.ArgumentList.Arguments.FirstOrDefault();
        if (first?.Expression is LiteralExpressionSyntax lit && lit.IsKind(SyntaxKind.StringLiteralExpression))
        {
            return lit.Token.ValueText;
        }
        return null;
    }

    private static EdgeEvidence Evidence(string path, SyntaxNode node)
    {
        var span = node.GetLocation().GetLineSpan();
        return new EdgeEvidence(path, span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1);
    }

    private static DependencyEdge MakeEdge(
        string from, string to, EdgeKind kind, EdgeTransport transport,
        EdgeDirection direction, EdgePattern pattern,
        string? contract, string? contractAsm, string? endpoint,
        bool external, EdgeEvidence ev) =>
        new(from, to, kind, transport, direction, pattern, contract, contractAsm, endpoint, external, ev);

    private static string PhantomFor(string typeOrKey, string? asm = null) =>
        asm is null ? $"external:{typeOrKey}" : $"external:{asm}:{typeOrKey}";
}
