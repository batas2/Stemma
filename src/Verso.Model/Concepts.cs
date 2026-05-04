namespace Verso.Model;

/// <summary>Common base for any node-like architecture element.</summary>
public abstract record ModelElement(string Id, string Name);

/// <summary>A unit of cohesion within a Bounded Context.</summary>
public sealed record Module(string Id, string Name, string? ContextId = null) : ModelElement(Id, Name);

/// <summary>A Domain-Driven Design Bounded Context.</summary>
public sealed record BoundedContext(string Id, string Name) : ModelElement(Id, Name);

/// <summary>A C4 Software System.</summary>
public sealed record SoftwareSystem(string Id, string Name) : ModelElement(Id, Name);

/// <summary>A C4 Container (deployable unit) inside a Software System.</summary>
public sealed record Container(string Id, string Name, string SystemId, string Kind = "service") : ModelElement(Id, Name);

/// <summary>A C4 Person / actor.</summary>
public sealed record Person(string Id, string Name, string Role = "user") : ModelElement(Id, Name);

/// <summary>A user-visible use case.</summary>
public sealed record UseCase(string Id, string Name) : ModelElement(Id, Name);

/// <summary>A business capability.</summary>
public sealed record Capability(string Id, string Name, string? ContextId = null) : ModelElement(Id, Name);

/// <summary>Common base for relationships.</summary>
public abstract record ModelLink(string Id, string FromId, string ToId);

/// <summary>A flow of data between two model elements.</summary>
public sealed record DataFlow(string Id, string FromId, string ToId, string Payload, string Direction = "oneway") : ModelLink(Id, FromId, ToId);

/// <summary>A dependency between two model elements (uses, calls, owns...).</summary>
public sealed record Dependency(string Id, string FromId, string ToId, string Kind = "uses") : ModelLink(Id, FromId, ToId);

/// <summary>
/// Lifecycle metadata attachable to any element or relationship. Status is open-enum:
/// `current`, `target`, `to-adapt`, `to-be-created`, `deprecated`, `proposed`, or any
/// user-defined string.
/// </summary>
public sealed record Lifecycle(
    string? Status = null,
    string? Phase = null,
    string? ValidFrom = null,
    string? ValidUntil = null);

/// <summary>
/// Ownership metadata attachable to any element or relationship. RAPID role lists are
/// strings of names (multiple people allowed per role).
/// </summary>
public sealed record Ownership(
    string? Squad = null,
    string? Domain = null,
    IReadOnlyList<string>? Recommend = null,
    IReadOnlyList<string>? Agree = null,
    IReadOnlyList<string>? Perform = null,
    IReadOnlyList<string>? Input = null,
    IReadOnlyList<string>? Decide = null);

/// <summary>
/// An architecture decision (ADR). Structured fields live in Architecture.cs; the long-form
/// context, consequences, and rationale live in `Decisions/&lt;id&gt;-&lt;slug&gt;.md`.
/// Status is open-enum: `proposed`, `accepted`, `rejected`, `superseded`, `deprecated`.
/// </summary>
public sealed record Decision(
    string Id,
    string Title,
    string Status = "proposed",
    string? Date = null,
    string? ChosenOptionId = null) : ModelElement(Id, Title)
{
    /// <summary>
    /// Marker call: declares that this Decision concerns one or more model elements.
    /// Verso reads it from the DSL syntax tree; the runtime body is intentionally empty.
    /// </summary>
    public static void Concerns(Decision decision, params ModelElement[] elements) { }

    /// <summary>
    /// Marker call: `newer` supersedes `older`. Read from the DSL syntax tree.
    /// </summary>
    public static void Supersedes(Decision newer, Decision older) { }
}

/// <summary>
/// A candidate resolution to a Decision. Options live alongside their Decision in the DSL.
/// </summary>
public sealed record DecisionOption(
    string Id,
    string Title,
    string? DecisionId = null) : ModelElement(Id, Title);

/// <summary>
/// A user-defined view: a named subset of the canonical model with an optional base lens
/// (`c4Context`, `moduleMap`, `dependencyGraph`, or `all`). Encoded as `Views/<Name>.cs`
/// files in the workspace.
/// </summary>
public sealed record View(
    string Id,
    string Name,
    string BaseView,
    IReadOnlyList<string> ElementIds);

/// <summary>
/// A tag attaches a Lifecycle and/or Ownership to an existing element or link by id.
/// Encoded in the DSL as `Tag.For(elem, lifecycle: ..., ownership: ...)` calls.
/// </summary>
public sealed record Tag(string TargetId, Lifecycle? Lifecycle = null, Ownership? Ownership = null)
{
    public static Tag For(ModelElement target, Lifecycle? lifecycle = null, Ownership? ownership = null)
        => new(target.Id, lifecycle, ownership);

    public static Tag For(ModelLink target, Lifecycle? lifecycle = null, Ownership? ownership = null)
        => new(target.Id, lifecycle, ownership);
}
