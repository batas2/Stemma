namespace Stemma.Engine.Adapters.Yaml;

/// <summary>
/// Schema constants for the YAML adapter. Versioning per ADR-0011: every `*.stemma.yaml`
/// file declares a top-level `version: 1` key. Loader refuses files without it.
/// </summary>
public static class YamlSchema
{
    public const int CurrentVersion = 1;
    public const string VersionKey = "version";
    public const string ConceptsKey = "concepts";
    public const string RelationsKey = "relations";
    public const string BooksKey = "books";

    /// <summary>Recognised top-level files under <c>Concepts/</c>.</summary>
    public static readonly IReadOnlyList<string> KnownFiles = new[]
    {
        "data-model.stemma.yaml",
        "resources.stemma.yaml",
        "governance.stemma.yaml",
        "view-book.stemma.yaml",
        "capabilities.stemma.yaml",
    };
}
