namespace Verso.Engine.Adapters.Yaml;

/// <summary>
/// Orchestrator for the YAML storage adapter. Loads <c>Concepts/*.verso.yaml</c>
/// files from a workspace root and dispatches mutation ops to the trivia-preserving
/// writer. See ADR-0011 for the round-trip contract.
/// </summary>
public sealed class YamlAdapter : IStorageAdapter
{
    public string Name => "yaml";

    public string ConceptsDirectory { get; }
    public Dictionary<string, YamlConceptFile> Files { get; } = new(StringComparer.OrdinalIgnoreCase);

    public YamlAdapter(string conceptsDirectory)
    {
        ConceptsDirectory = conceptsDirectory;
    }

    public static YamlAdapter Load(string workspaceRoot)
    {
        var dir = Path.Combine(workspaceRoot, "Concepts");
        var adapter = new YamlAdapter(dir);
        if (!Directory.Exists(dir)) return adapter;
        foreach (var path in Directory.EnumerateFiles(dir, "*.verso.yaml", SearchOption.TopDirectoryOnly))
        {
            var text = File.ReadAllText(path);
            var parsed = YamlConceptReader.Parse(path, text);
            if (parsed.Version != YamlSchema.CurrentVersion)
                throw new YamlSchemaException($"{path}: expected `version: {YamlSchema.CurrentVersion}`, got `{parsed.Version}`");
            adapter.Files[Path.GetFileName(path)] = parsed;
        }
        return adapter;
    }

    public void Save(YamlConceptFile file)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file.FilePath)!);
        var text = YamlConceptWriter.Render(file);
        File.WriteAllText(file.FilePath, text);
        file.Text = text;
    }

    public YamlConceptFile GetOrCreate(string fileName)
    {
        if (Files.TryGetValue(fileName, out var existing)) return existing;
        var path = Path.Combine(ConceptsDirectory, fileName);
        var fresh = new YamlConceptFile { FilePath = path, Version = YamlSchema.CurrentVersion };
        Files[fileName] = fresh;
        return fresh;
    }

    public IEnumerable<YamlConceptEntry> AllConcepts => Files.Values.SelectMany(f => f.Concepts);
    public IEnumerable<YamlRelationEntry> AllRelations => Files.Values.SelectMany(f => f.Relations);
    public IEnumerable<YamlBookEntry> AllBooks => Files.Values.SelectMany(f => f.Books);

    public YamlConceptEntry? FindConcept(string id) =>
        AllConcepts.FirstOrDefault(c => string.Equals(c.Id, id, StringComparison.Ordinal));

    public YamlRelationEntry? FindRelation(string id) =>
        AllRelations.FirstOrDefault(r => string.Equals(r.Id, id, StringComparison.Ordinal));

    public YamlBookEntry? FindBook(string id) =>
        AllBooks.FirstOrDefault(b => string.Equals(b.Id, id, StringComparison.Ordinal));
}

public sealed class YamlSchemaException : Exception
{
    public YamlSchemaException(string message) : base(message) { }
}
