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
