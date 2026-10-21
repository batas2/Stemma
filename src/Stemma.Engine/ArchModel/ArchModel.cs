namespace Stemma.Engine.ArchModel;

/// <summary>
/// Stemma's runtime view of an architecture model. Read from a user's `Architecture/Architecture.cs`
/// via Roslyn, mutated by ops, written back via DocumentEditor edits.
/// </summary>
public sealed record ArchModel(
    string FilePath,
    IReadOnlyList<ArchElement> Elements,
    IReadOnlyList<ArchLink> Links,
    IReadOnlyList<ArchTag> Tags)
{
    /// <summary>
    /// What the model files declare that could not be read, and what that left out. Validation
    /// reports each one (<c>model/unreadable-declaration</c>); a declaration the reader cannot read
    /// is never dropped in silence.
    /// </summary>
    public IReadOnlyList<ArchReadProblem> Unreadable { get; init; } = [];
}

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

/// <summary>
/// Something in a model file the reader could not read: an argument written in a form whose value
/// cannot be known from the source, or a tag where Stemma does not look for one.
/// </summary>
/// <param name="Id">The element or link it belongs to, when that is in the model; null when it was left out.</param>
/// <param name="LeftOut">Whether a whole declaration is missing from the model because of it.</param>
/// <param name="Message">Said for the person who opens the file: where, what, and what it cost.</param>
public sealed record ArchReadProblem(string FilePath, int Line, string? Id, bool LeftOut, string Message);
