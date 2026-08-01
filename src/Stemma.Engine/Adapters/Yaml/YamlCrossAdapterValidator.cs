using System.Text.RegularExpressions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Validation;

namespace Stemma.Engine.Adapters.Yaml;

/// <summary>
/// Cross-adapter referential integrity check (ADR-0013). Runs after a workspace
/// loads. Emits a <c>dangling-reference</c> violation for every YAML concept
/// property or YAML relation endpoint that points to an id which exists nowhere
/// (neither in YAML nor in the in-memory Roslyn ArchModel).
///
/// The engine loads with violations; ViolationsPanel surfaces them. Same severity
/// bar as Epic 03 validation rules — not a hard fail.
/// </summary>
public static class YamlCrossAdapterValidator
{
    public const string RuleId = "yaml-cross-adapter-reference";

    private static readonly Regex IdShape = new(@"^[a-z]{2,4}_[a-z0-9_-]+$", RegexOptions.Compiled);

    public static IReadOnlyList<Violation> Run(YamlAdapter yaml, ArchModel.ArchModel? arch)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in yaml.AllConcepts) ids.Add(c.Id);
        foreach (var b in yaml.AllBooks) ids.Add(b.Id);
        if (arch is not null)
        {
            foreach (var e in arch.Elements) ids.Add(e.Id);
            foreach (var l in arch.Links) ids.Add(l.Id);
        }

        var violations = new List<Violation>();
        foreach (var rel in yaml.AllRelations)
        {
            if (rel.From.Length > 0 && !ids.Contains(rel.From))
                violations.Add(new Violation(RuleId, Severity.Warning,
                    $"YAML relation `{rel.Id}` points to unknown id `{rel.From}` (from)", [], []));
            if (rel.To.Length > 0 && !ids.Contains(rel.To))
                violations.Add(new Violation(RuleId, Severity.Warning,
                    $"YAML relation `{rel.Id}` points to unknown id `{rel.To}` (to)", [], []));
        }
        foreach (var c in yaml.AllConcepts)
        {
            foreach (var p in c.Properties)
            {
                if (p.Value.Length == 0) continue;
                if (!IdShape.IsMatch(p.Value)) continue;
                if (!ids.Contains(p.Value))
                    violations.Add(new Violation(RuleId, Severity.Warning,
                        $"YAML concept `{c.Id}` property `{p.Key}` references unknown id `{p.Value}`", [], []));
            }
        }
        return violations;
    }
}
