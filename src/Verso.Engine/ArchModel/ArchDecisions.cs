namespace Verso.Engine.ArchModel;

public enum DecisionStatus { Proposed, Accepted, Rejected, Superseded, Deprecated, Other }

public sealed record ArchDecision(
    string Id,
    string Title,
    string Status,
    string? Date,
    string? ChosenOptionId);

public sealed record ArchDecisionOption(
    string Id,
    string Title,
    string DecisionId);

/// <summary>A `Decision.Concerns(decision, ...elements)` call — flattened to one entry per element.</summary>
public sealed record ArchDecisionConcerns(string DecisionId, string ElementId);

/// <summary>A `Decision.Supersedes(newer, older)` call.</summary>
public sealed record ArchDecisionSupersedes(string NewerDecisionId, string OlderDecisionId);
