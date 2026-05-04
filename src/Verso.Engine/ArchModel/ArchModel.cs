namespace Verso.Engine.ArchModel;

/// <summary>
/// Verso's runtime view of an architecture model. Read from a user's `Architecture/Architecture.cs`
/// via Roslyn, mutated by ops, written back via DocumentEditor edits.
/// </summary>
public sealed record ArchModel(
    string FilePath,
    IReadOnlyList<ArchElement> Elements,
    IReadOnlyList<ArchLink> Links);

public enum ArchElementKind { Module, BoundedContext, SoftwareSystem, Container, Person, UseCase, Capability }
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
