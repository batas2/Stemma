namespace Stemma.Engine.ArchModel;

/// <summary>
/// The constructor shapes of the <c>Stemma.Model</c> records, in the terms the engine uses for them.
/// The reader and the writer both need to know that a Module's third argument is its context, and
/// they must agree; this is the one place that says so.
///
/// Names are the model's attribute names (<c>contextId</c>), which are the C# parameter names
/// (<c>ContextId</c>) with a lower-case first letter. A named argument in the source is mapped back
/// through <see cref="AttributeName"/>, so <c>new Module(Id: "m", Name: "M")</c> reads the same as
/// the positional form.
/// </summary>
internal static class DslVocabulary
{
    public static IReadOnlyList<string>? ParametersOf(string typeName) => typeName switch
    {
        "Module" => ["id", "name", "contextId"],
        "BoundedContext" => ["id", "name"],
        "SoftwareSystem" => ["id", "name"],
        "Container" => ["id", "name", "systemId", "kind"],
        "Person" => ["id", "name", "role"],
        "UseCase" => ["id", "name"],
        "Capability" => ["id", "name", "contextId"],
        "Question" => ["id", "name", "aboutId"],
        "Assumption" => ["id", "name", "aboutId"],
        "Risk" => ["id", "name", "aboutId"],
        // Id and name, and nothing else. A Concept that acquired a contextId would be a Module with
        // extra steps, which is the thing this kind exists to avoid.
        "Concept" => ["id", "name"],
        "DataFlow" => ["id", "fromId", "toId", "payload", "direction"],
        "Dependency" => ["id", "fromId", "toId", "kind"],
        "Relation" => ["id", "fromId", "toId", "label"],
        "Lifecycle" => ["status", "phase", "validFrom", "validUntil"],
        "Ownership" => ["squad", "domain", "recommend", "agree", "perform", "input", "decide"],
        "View" => ["id", "name", "baseView", "elementIds"],
        _ => null,
    };

    /// <summary><c>ContextId</c> → <c>contextId</c>.</summary>
    public static string AttributeName(string parameter) =>
        parameter.Length == 0 ? parameter : char.ToLowerInvariant(parameter[0]) + parameter[1..];

    /// <summary><c>contextId</c> → <c>ContextId</c>, for writing a named argument.</summary>
    public static string ParameterName(string attribute) =>
        attribute.Length == 0 ? attribute : char.ToUpperInvariant(attribute[0]) + attribute[1..];
}
