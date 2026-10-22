namespace Stemma.Model;

/// <summary>Common base for any node-like architecture element.</summary>
public abstract record ModelElement(string Id, string Name);

/// <summary>A unit of cohesion within a Bounded Context.</summary>
public sealed record Module(string Id, string Name, string? ContextId = null) : ModelElement(Id, Name);

/// <summary>A Domain-Driven Design Bounded Context.</summary>
public sealed record BoundedContext(string Id, string Name) : ModelElement(Id, Name);

/// <summary>
/// A C4 Software System. `Description` is the sentence a C4 card carries under its name — what the
/// system is for (ADR-0027).
/// </summary>
public sealed record SoftwareSystem(string Id, string Name, string? Description = null) : ModelElement(Id, Name);

/// <summary>
/// A C4 Container (deployable unit) inside a Software System. `Kind` is what sort of thing it is
/// (`service`, `db`, `spa`, …); `Technology` is what it is built with (`.NET 8`, `PostgreSQL`), and
/// `Description` what it does — the two lines of a C4 container card (ADR-0027).
/// </summary>
public sealed record Container(
    string Id,
    string Name,
    string SystemId,
    string Kind = "service",
    string? Technology = null,
    string? Description = null) : ModelElement(Id, Name);

/// <summary>A C4 Person / actor. `Description` says who they are and what they come for (ADR-0027).</summary>
public sealed record Person(string Id, string Name, string Role = "user", string? Description = null) : ModelElement(Id, Name);

/// <summary>A user-visible use case.</summary>
public sealed record UseCase(string Id, string Name) : ModelElement(Id, Name);

/// <summary>A business capability.</summary>
public sealed record Capability(string Id, string Name, string? ContextId = null) : ModelElement(Id, Name);

/// <summary>
/// A named thing in an argument, asserting nothing about a system.
///
/// Deliberately the poorest element in the vocabulary: no context, no system, no lifecycle, no
/// ownership, and no place in the built-in lenses. That poverty is the point — it exists so that an
/// essay's argument does not have to declare itself a Bounded Context to get a box on a canvas.
/// You cannot prevent an escape hatch; you can only choose whether it is labelled. See ADR-0018.
/// </summary>
public sealed record Concept(string Id, string Name) : ModelElement(Id, Name);

/// <summary>A design Question raised on the canvas. `AboutId` optionally links it to the
/// model element it concerns.</summary>
public sealed record Question(string Id, string Name, string? AboutId = null) : ModelElement(Id, Name);

/// <summary>A design Assumption. `AboutId` optionally links it to what it concerns.</summary>
public sealed record Assumption(string Id, string Name, string? AboutId = null) : ModelElement(Id, Name);

/// <summary>A design Risk. `AboutId` optionally links it to what it concerns.</summary>
public sealed record Risk(string Id, string Name, string? AboutId = null) : ModelElement(Id, Name);

/// <summary>Common base for relationships.</summary>
public abstract record ModelLink(string Id, string FromId, string ToId);

/// <summary>
/// A flow of data between two model elements. `Payload` is what travels; `Technology` is how
/// (`HTTPS/JSON`, `AMQP`), drawn after the payload as C4 draws a relationship's (ADR-0027).
/// </summary>
public sealed record DataFlow(
    string Id,
    string FromId,
    string ToId,
    string Payload,
    string Direction = "oneway",
    string? Technology = null) : ModelLink(Id, FromId, ToId);

/// <summary>A dependency between two model elements (uses, calls, owns...).</summary>
public sealed record Dependency(string Id, string FromId, string ToId, string Kind = "uses") : ModelLink(Id, FromId, ToId);

/// <summary>
/// A labelled arrow between two elements that claims nothing beyond its label.
///
/// The counterpart to <see cref="Concept"/>: if `Module` was the wrong word for a box in an
/// argument, `Dependency` was the wrong word for the arrow between two ideas. `Relation` carries a
/// free-text label and no semantics, so a diagram can say "becomes" or "answered by" without
/// asserting a dependency that does not exist. See ADR-0019.
/// </summary>
public sealed record Relation(string Id, string FromId, string ToId, string Label = "") : ModelLink(Id, FromId, ToId);

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
/// An architecture decision. Retained as model vocabulary so workspaces that declared
/// decisions keep compiling, but Stemma no longer reads, edits, or renders them — the
/// decision-editing feature (ops, Markdown narratives, Decision Log view) was removed.
/// </summary>
public sealed record Decision(
    string Id,
    string Title,
    string Status = "proposed",
    string? Date = null,
    string? ChosenOptionId = null) : ModelElement(Id, Title)
{
    /// <summary>Marker call: declares that this Decision concerns one or more elements.</summary>
    public static void Concerns(Decision decision, params ModelElement[] elements) { }

    /// <summary>Marker call: `newer` supersedes `older`.</summary>
    public static void Supersedes(Decision newer, Decision older) { }
}

/// <summary>A candidate resolution to a <see cref="Decision"/>. Inert model vocabulary (see Decision).</summary>
public sealed record DecisionOption(
    string Id,
    string Title,
    string? DecisionId = null) : ModelElement(Id, Title);

/// <summary>
/// A user-defined view: a named subset of the canonical model seen through a base lens
/// (`moduleMap`, `dependencyGraph`, `all`, or the C4 lenses `systemContext` and `container`).
/// Encoded as `Views/<Name>.cs` files in the workspace.
///
/// A view is a list, a scope and rules (ADR-0026). Its members are the lens's — for a C4 lens, the
/// software system named by `Scope` and whatever relates to it — then `ElementIds`, then what the
/// `Include` selectors select, minus what the `Exclude` selectors select. A selector is an id, `id.*`
/// (its children), `*`, `kind:container`, any of those with filters such as `[technology=PostgreSQL]`,
/// or `->X` / `X->` / `->X->` for X and its neighbours. Stemma resolves them; nothing here runs them.
/// </summary>
public sealed record View(
    string Id,
    string Name,
    string BaseView,
    IReadOnlyList<string>? ElementIds = null,
    string? Scope = null,
    IReadOnlyList<string>? Include = null,
    IReadOnlyList<string>? Exclude = null);

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
