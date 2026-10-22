using Stemma.Engine.ArchModel;

namespace Stemma.Engine.Validation;

/// <summary>
/// The rules a workspace adds to the built-in ones, as <see cref="IRule"/>s the <see cref="RuleEngine"/> runs
/// beside them (ADR-0028 decision 4): each rule its <c>Rules/*.cs</c> files declare, under its own id; one
/// rule per kind of mistake in those files (<c>rule/unreadable</c>, <c>rule/bad-selector</c>, …); and the
/// packs they turn on. So the canvas and <c>stemma validate</c> show the same violations, and
/// <c>stemma.rules.json</c> switches any of them off or changes its severity by its id, as it does a
/// built-in rule's.
/// </summary>
public static class WorkspaceRules
{
    /// <summary>The workspace's rules, read from disk now.</summary>
    public static IReadOnlyList<IRule> For(string workspaceRoot) => For(workspaceRoot, DeclaredRules.Read(workspaceRoot));

    public static IReadOnlyList<IRule> For(string workspaceRoot, DeclaredRules declared)
    {
        if (declared.Files.Count == 0) return [];
        var scopes = new PerModel<SelectorScope>(model => new SelectorScope(model));
        var rules = new List<IRule>();
        rules.AddRange(declared.Rules.Select(r => new DeclaredRuleCheck(r, scopes)));
        rules.AddRange(DeclaredRules.MistakeIds.Select(id => new RuleMistakes(id, declared, scopes)));
        if (declared.Uses(C4Pack.Name)) rules.AddRange(C4Pack.Rules(scopes));
        return rules;
    }
}

/// <summary>
/// Something worked out once per model and shared by the rules that need it — the selector scope, the
/// conformance comparison. The engine runs every rule over one model in turn, so the last answer is the
/// one asked for again.
/// </summary>
internal sealed class PerModel<T>(Func<ArchModel.ArchModel, T> compute) where T : class
{
    private readonly object _lock = new();
    private ArchModel.ArchModel? _model;
    private T? _value;

    public T For(ArchModel.ArchModel model)
    {
        lock (_lock)
        {
            if (!ReferenceEquals(model, _model) || _value is null)
            {
                _value = compute(model);
                _model = model;
            }
            return _value;
        }
    }
}

/// <summary>A declared rule, run under its own id at the severity it declares.</summary>
internal sealed class DeclaredRuleCheck(DeclaredRule rule, PerModel<SelectorScope> scopes) : IRule
{
    public string Id => rule.Id;
    public Severity DefaultSeverity => rule.Severity;
    public string Description => rule.Because ?? $"Rule.{rule.Kind}, declared in {rule.File}:{rule.Line}.";
    public IEnumerable<Violation> Check(ArchModel.ArchModel model) => DeclaredRuleEvaluator.Evaluate(rule, scopes.For(model));
}

/// <summary>
/// One kind of mistake in the rules files, reported where it is: what the reader found, and — for
/// <c>rule/dangling-id</c> — the ids the rules name that the model does not have.
/// </summary>
internal sealed class RuleMistakes(string id, DeclaredRules declared, PerModel<SelectorScope> scopes) : IRule
{
    public string Id => id;
    public Severity DefaultSeverity => Severity.Error;
    public string Description => "Every rule Stemma is asked to check can be read and names what exists.";

    public IEnumerable<Violation> Check(ArchModel.ArchModel model)
    {
        foreach (var problem in declared.Problems.Where(p => p.Rule == id))
            yield return new Violation(id, problem.Severity, problem.Message, [], []);
        if (id != DeclaredRules.DanglingId) yield break;
        foreach (var violation in DeclaredRuleEvaluator.DanglingIds(declared, scopes.For(model)))
            yield return violation;
    }
}
