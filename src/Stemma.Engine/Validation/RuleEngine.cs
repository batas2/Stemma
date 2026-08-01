using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Stemma.Engine.Validation;

/// <summary>
/// Discovers all rules (built-in [StemmaRule] classes plus user-defined rules in the workspace
/// assembly), applies any stemma.rules.json overrides, and runs them against an ArchModel.
/// </summary>
public sealed class RuleEngine
{
    private readonly List<IRule> _rules;
    private readonly RulesConfig _config;

    public RuleEngine(IEnumerable<IRule> rules, RulesConfig config)
    {
        _rules = rules.ToList();
        _config = config;
    }

    public static RuleEngine Default(string? workspaceRoot = null)
    {
        var rules = DiscoverRulesIn(typeof(IRule).Assembly).ToList();
        var config = workspaceRoot is not null ? RulesConfig.LoadFor(workspaceRoot) : RulesConfig.Empty;
        return new RuleEngine(rules, config);
    }

    public IReadOnlyList<IRule> Rules => _rules;

    public IReadOnlyList<Violation> Run(ArchModel.ArchModel model)
    {
        var results = new List<Violation>();
        foreach (var rule in _rules)
        {
            if (_config.IsDisabled(rule.Id)) continue;
            try
            {
                foreach (var violation in rule.Check(model))
                {
                    var severity = _config.Override(rule.Id) ?? violation.Severity;
                    results.Add(violation with { Severity = severity });
                }
            }
            catch (Exception e)
            {
                results.Add(new Violation(rule.Id, Severity.Error,
                    $"Rule {rule.Id} threw: {e.Message}", [], []));
            }
        }
        return results;
    }

    public static IEnumerable<IRule> DiscoverRulesIn(Assembly asm)
    {
        foreach (var type in asm.GetTypes())
        {
            if (type.IsAbstract || !typeof(IRule).IsAssignableFrom(type)) continue;
            if (type.GetConstructor(Type.EmptyTypes) is null) continue;
            yield return (IRule)Activator.CreateInstance(type)!;
        }
    }
}

public sealed class RulesConfig
{
    public Dictionary<string, RuleConfigEntry> Rules { get; set; } = new();

    public static readonly RulesConfig Empty = new();

    public static RulesConfig LoadFor(string workspaceRoot)
    {
        var path = Path.Combine(workspaceRoot, "stemma.rules.json");
        if (!File.Exists(path)) return new RulesConfig();
        try
        {
            var text = File.ReadAllText(path);
            return JsonSerializer.Deserialize<RulesConfig>(text, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
            }) ?? new RulesConfig();
        }
        catch { return new RulesConfig(); }
    }

    public bool IsDisabled(string ruleId) =>
        Rules.TryGetValue(ruleId, out var entry) && entry.Enabled == false;

    public Severity? Override(string ruleId) =>
        Rules.TryGetValue(ruleId, out var entry) ? entry.Severity : null;
}

public sealed class RuleConfigEntry
{
    public bool? Enabled { get; set; }
    public Severity? Severity { get; set; }
}
