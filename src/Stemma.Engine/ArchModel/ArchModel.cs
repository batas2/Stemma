namespace Stemma.Engine.ArchModel;

/// <summary>
/// Stemma's runtime view of an architecture model. Read from a user's `Architecture/Architecture.cs`
/// via Roslyn, mutated by ops, written back via DocumentEditor edits.
/// </summary>
public sealed record ArchModel(
    string FilePath,
    IReadOnlyList<ArchElement> Elements,
    IReadOnlyList<ArchLink> Links,
    IReadOnlyList<ArchTag> Tags);

public enum ArchElementKind { Module, BoundedContext, SoftwareSystem, Container, Person, UseCase, Capability, Question, Assumption, Risk, Concept }
public enum ArchLinkKind { DataFlow, Dependency, Relation }

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

/// <summary>
/// Where an id is declared, and the line of C# that declares it — the file's own text, not a
/// rendering of the model. Used to show someone what their edit actually wrote.
/// </summary>
/// <param name="Line">1-based, so it matches what an editor shows.</param>
public sealed record DslDeclaration(string Id, string FilePath, int Line, string Text);
