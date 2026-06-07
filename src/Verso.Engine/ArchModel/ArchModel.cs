namespace Verso.Engine.ArchModel;

/// <summary>
/// Verso's runtime view of an architecture model. Read from a user's `Architecture/Architecture.cs`
/// via Roslyn, mutated by ops, written back via DocumentEditor edits.
/// </summary>
public sealed record ArchModel(
    string FilePath,
    IReadOnlyList<ArchElement> Elements,
    IReadOnlyList<ArchLink> Links,
    IReadOnlyList<ArchTag> Tags);

public enum ArchElementKind { Module, BoundedContext, SoftwareSystem, Container, Person, UseCase, Capability, Question, Assumption, Risk }
public enum ArchLinkKind { DataFlow, Dependency }

public sealed record ArchElement(
    string Id,
    string Name,
    ArchElementKind Kind,
    IReadOnlyDictionary<string, string?> Attributes);

public sealed record ArchLink(
    string Id,
    string FromId,
    string ToId,
    ArchLinkKind Kind,
    IReadOnlyDictionary<string, string?> Attributes);

public sealed record ArchLifecycle(string? Status = null, string? Phase = null, string? ValidFrom = null, string? ValidUntil = null);

public sealed record ArchOwnership(
    string? Squad = null,
    string? Domain = null,
    IReadOnlyList<string>? Recommend = null,
    IReadOnlyList<string>? Agree = null,
    IReadOnlyList<string>? Perform = null,
    IReadOnlyList<string>? Input = null,
    IReadOnlyList<string>? Decide = null);

public sealed record ArchTag(string TargetId, ArchLifecycle? Lifecycle, ArchOwnership? Ownership);
