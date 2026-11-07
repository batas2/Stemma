using System.Text.Json;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;

namespace Stemma.Cli;

/// <summary>What a comment is on, named from the workspace: the target's kind and name as well as its id.</summary>
/// <param name="Kind">An element or link kind in camelCase (<c>module</c>, <c>dataFlow</c>), <c>view</c> or <c>shape</c>.</param>
/// <param name="Exists">False when the model, the views and the sidecar no longer have it.</param>
internal sealed record ReviewTarget(string TargetKind, string Id, string Kind, string Name, bool Exists)
{
    /// <summary>"module “Payments” (mod_pay)", or "mod_pay, no longer in the model" — the kind in lower case, as it reads mid-sentence.</summary>
    public string Describe() => Describe(t => t, id => $"({id})");

    /// <summary>As <see cref="Describe()"/>, with the words and the id each written by the caller (Markdown escapes one and quotes the other).</summary>
    public string Describe(Func<string, string> text, Func<string, string> id) => Exists
        ? $"{text($"{KindLabel(Kind)} {ModelDiff.Quoted(Name)}")} {id(Id)}"
        : $"{id(Id).Trim('(', ')')}{text($", {(TargetKind == "view" ? "no longer a view" : TargetKind == "shape" ? "no longer on any view" : "no longer in the model")}")}";

    private static string KindLabel(string kind) => kind switch
    {
        "view" => "view",
        "shape" => "shape",
        "dataFlow" => "data flow",
        "dependency" => "dependency",
        "relation" => "relation",
        _ => Enum.TryParse<ArchElementKind>(kind, ignoreCase: true, out var k) ? ModelDiff.KindLabel(k).ToLowerInvariant() : kind,
    };
}

/// <summary>The workspace's elements, links, views and shapes, read once, for naming what comments are on.</summary>
internal sealed class ReviewTargets
{
    private static readonly Dictionary<string, string> BuiltInViews = new(StringComparer.Ordinal)
    {
        ["moduleMap"] = "Module Map",
        ["dependencyGraph"] = "Dependency Graph",
    };

    private readonly Dictionary<string, ArchElement> _elements = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ArchLink> _links = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _views = new(BuiltInViews, StringComparer.Ordinal);
    private readonly Dictionary<string, string> _shapes = new(StringComparer.Ordinal);

    public ReviewTargets(string workspace)
    {
        var model = ArchModelMerge.ReadFrom(workspace).Model;
        foreach (var e in model?.Elements ?? []) _elements.TryAdd(e.Id, e);
        foreach (var l in model?.Links ?? []) _links.TryAdd(l.Id, l);
        foreach (var (_, view) in WorkspaceViews.Read(workspace)) _views.TryAdd(view.Id, view.Name);
        ReadShapes(LayoutSidecar.PathFor(workspace));
    }

    public ReviewTarget For(string targetKind, string id)
    {
        switch (targetKind)
        {
            case "view":
                return _views.TryGetValue(id, out var view) ? new(targetKind, id, "view", view, true) : new(targetKind, id, "view", id, false);
            case "shape":
                return _shapes.TryGetValue(id, out var label) ? new(targetKind, id, "shape", label, true) : new(targetKind, id, "shape", id, false);
            default:
                if (_elements.TryGetValue(id, out var e)) return new(targetKind, id, Camel(e.Kind.ToString()), e.Name, true);
                if (_links.TryGetValue(id, out var l)) return new(targetKind, id, Camel(l.Kind.ToString()), ModelDiff.DescribeLink(l, NameOf), true);
                return new(targetKind, id, "element", id, false);
        }
    }

    /// <summary>The comment target kind an id would be commented on as, or null when the workspace has no such thing.</summary>
    public string? TargetKindOf(string id) =>
        _elements.ContainsKey(id) || _links.ContainsKey(id) ? "element" : _views.ContainsKey(id) ? "view" : null;

    private string NameOf(string id) => _elements.TryGetValue(id, out var e) ? e.Name : id;

    /// <summary>Every shape on every view, by id, with its label when it has one. A sidecar that cannot be read names none.</summary>
    private void ReadShapes(string path)
    {
        if (!File.Exists(path)) return;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
            if (!doc.RootElement.TryGetProperty("views", out var views) || views.ValueKind != JsonValueKind.Object) return;
            foreach (var view in views.EnumerateObject())
            {
                if (view.Value.ValueKind != JsonValueKind.Object || !view.Value.TryGetProperty("shapes", out var shapes) || shapes.ValueKind != JsonValueKind.Array) continue;
                foreach (var shape in shapes.EnumerateArray())
                {
                    if (shape.ValueKind != JsonValueKind.Object || !shape.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String) continue;
                    var label = shape.TryGetProperty("label", out var l) && l.ValueKind == JsonValueKind.String && l.GetString() is { Length: > 0 } text
                        ? text
                        : shape.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString()! : "shape";
                    _shapes.TryAdd(id.GetString()!, label);
                }
            }
        }
        catch (JsonException) { }
    }

    private static string Camel(string name) => char.ToLowerInvariant(name[0]) + name[1..];
}
