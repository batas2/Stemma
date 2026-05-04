using Verso.Engine.ArchModel;

namespace Verso.Engine.Validation;

public enum Severity { Info, Warning, Error }

public sealed record Violation(
    string RuleId,
    Severity Severity,
    string Message,
    IReadOnlyList<string> ElementIds,
    IReadOnlyList<string> LinkIds);

public interface IRule
{
    string Id { get; }
    Severity DefaultSeverity { get; }
    string Description { get; }
    IEnumerable<Violation> Check(ArchModel.ArchModel model);
}

[AttributeUsage(AttributeTargets.Class, AllowMultiple = false)]
public sealed class VersoRuleAttribute : Attribute
{
    public string Id { get; }
    public Severity DefaultSeverity { get; }
    public string Description { get; }

    public VersoRuleAttribute(string id, Severity defaultSeverity, string description)
    {
        Id = id;
        DefaultSeverity = defaultSeverity;
        Description = description;
    }
}
