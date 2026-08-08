using System.Text.Json;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;

namespace Stemma.Cli;

public enum CheckSeverity { Error, Warning, Info }

/// <summary>One thing that is wrong, or worth knowing, about a workspace.</summary>
public sealed record CheckFinding(CheckSeverity Severity, string Rule, string Message, string? ElementId = null);

/// <summary>
/// The checks the C# compiler cannot make.
///
/// Ids in flows, dependencies, `AboutId` and views are strings, and nothing verifies them at build
/// time or at run time — a typo produces a missing node or a missing edge, silently. For someone
/// working in the canvas that is a puzzle; for an agent that never sees the picture it is invisible,
/// and it renders a diagram that is quietly wrong rather than failing.
///
/// So this is written for a reader who cannot look: every finding names the rule, the element and
/// what to do, and the exit code distinguishes "this is broken" from "this is unusual".
/// </summary>
public static class WorkspaceCheck
{
    /// <summary>Above this many boxes a diagram has stopped answering one question. From the blog's
    /// own house style, and a warning rather than an error because it is a rule of thumb.</summary>
    public const int BusyViewThreshold = 7;

    public static IReadOnlyList<CheckFinding> Run(string workspaceRoot)
    {
        var findings = new List<CheckFinding>();

        var archPath = Path.Combine(workspaceRoot, "Architecture", "Architecture.cs");
        if (!File.Exists(archPath))
        {
            findings.Add(new(CheckSeverity.Error, "workspace/no-model",
                $"no model at {Path.Combine("Architecture", "Architecture.cs")} — is this a Stemma workspace?"));
            return findings;
        }

        var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(archPath));
        var model = DslReader.TryRead(archPath, tree.GetRoot());
        if (model is null)
        {
            findings.Add(new(CheckSeverity.Error, "model/unreadable",
                "Architecture.cs has no parseable `public static Model Build()` — the engine reads exactly that name."));
            return findings;
        }

        var ids = model.Elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
        findings.AddRange(DuplicateIds(model));
        findings.AddRange(DanglingLinkEndpoints(model, ids));
        findings.AddRange(DanglingAttributeReferences(model, ids));
        findings.AddRange(RegisterFindings(model));
        findings.AddRange(ViewFindings(workspaceRoot, model, ids));
        findings.AddRange(ShapeFindings(workspaceRoot, ids));

        return findings;
    }

    /// <summary>Matches `MAX_SHAPES_PER_VIEW` in the canvas, which stops drawing past it.</summary>
    public const int MaxShapesPerView = 256;

    private static readonly HashSet<string> ShapeKinds =
        new(StringComparer.Ordinal) { "rect", "ellipse", "triangle", "label", "arrow", "image" };

    /// <summary>
    /// Free-form annotation, checked because it is now authored by hand.
    ///
    /// Shapes are pure presentation and the engine deliberately does not model them, so nothing else
    /// looks at them at all: an arrow anchored to an element that was renamed simply detaches and
    /// falls back to its snapshot coordinates, which looks like a diagram someone drew carelessly
    /// rather than like a broken reference.
    /// </summary>
    private static IEnumerable<CheckFinding> ShapeFindings(string workspaceRoot, HashSet<string> elementIds)
    {
        var path = LayoutSidecar.PathFor(workspaceRoot);
        if (!File.Exists(path)) yield break;

        JsonDocument? doc = null;
        try { doc = JsonDocument.Parse(File.ReadAllText(path)); }
        catch (JsonException) { /* reported below — a yield cannot live in a catch */ }

        if (doc is null)
        {
            yield return new(CheckSeverity.Warning, "sidecar/unreadable",
                "stemma.layout.json does not parse; the canvas ignores it, so every position and annotation in it is lost");
            yield break;
        }

        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("views", out var views)) yield break;

            foreach (var view in views.EnumerateObject())
            {
                if (!view.Value.TryGetProperty("shapes", out var shapes) || shapes.ValueKind != JsonValueKind.Array) continue;

                var all = shapes.EnumerateArray().ToList();
                var shapeIds = all
                    .Select(s => s.TryGetProperty("id", out var id) ? id.GetString() : null)
                    .Where(id => id is not null).Select(id => id!)
                    .ToHashSet(StringComparer.Ordinal);

                if (all.Count > MaxShapesPerView)
                    yield return new(CheckSeverity.Warning, "shape/too-many",
                        $"view '{view.Name}' has {all.Count} shapes; the canvas stops drawing past {MaxShapesPerView}");

                foreach (var shape in all)
                {
                    var id = shape.TryGetProperty("id", out var i) ? i.GetString() : null;
                    var kind = shape.TryGetProperty("kind", out var k) ? k.GetString() : null;

                    if (id is null)
                    {
                        yield return new(CheckSeverity.Error, "shape/no-id",
                            $"view '{view.Name}' has a shape with no id; it cannot be selected, styled or removed");
                        continue;
                    }
                    if (kind is null || !ShapeKinds.Contains(kind))
                    {
                        yield return new(CheckSeverity.Error, "shape/unknown-kind",
                            $"shape '{id}' has kind '{kind ?? "(none)"}', which the canvas does not draw (known: {string.Join(", ", ShapeKinds.Order())})", id);
                        continue;
                    }
                    if (kind == "label" && string.IsNullOrWhiteSpace(shape.TryGetProperty("text", out var txt) ? txt.GetString() : null))
                        yield return new(CheckSeverity.Warning, "shape/empty-label",
                            $"label '{id}' has no text, so it draws nothing", id);

                    foreach (var end in new[] { "fromAnchor", "toAnchor" })
                    {
                        if (!shape.TryGetProperty(end, out var anchor) || anchor.ValueKind != JsonValueKind.Object) continue;
                        var anchorKind = anchor.TryGetProperty("kind", out var ak) ? ak.GetString() : null;
                        var target = anchor.TryGetProperty("id", out var tid) ? tid.GetString() : null;
                        if (anchorKind is null or "free" || target is null) continue;

                        var known = anchorKind == "element" ? elementIds.Contains(target) : shapeIds.Contains(target);
                        if (!known)
                            yield return new(CheckSeverity.Error, "shape/dangling-anchor",
                                $"arrow '{id}' anchors its {end[..^6]} end to {anchorKind} '{target}', which does not exist — the arrow silently detaches to its last known coordinates", id);
                    }
                }
            }
        }
    }

    /// <summary>
    /// Notes about what *kind* of document this is, per ADR-0018.
    ///
    /// Both are informational on purpose. `Concept` exists so an argument does not have to pretend
    /// to be an architecture; turning its presence into a warning would put the pretence back.
    /// </summary>
    private static IEnumerable<CheckFinding> RegisterFindings(ArchModel model)
    {
        var concepts = model.Elements.Count(e => e.Kind == ArchElementKind.Concept);
        if (concepts == 0) yield break;

        if (concepts > model.Elements.Count / 2)
            yield return new(CheckSeverity.Info, "model/is-a-figure",
                $"{concepts} of {model.Elements.Count} elements are Concepts — this is a figure rather than an architecture, which is a fine thing to be");
    }

    private static IEnumerable<CheckFinding> DuplicateIds(ArchModel model)
    {
        foreach (var group in model.Elements.GroupBy(e => e.Id, StringComparer.Ordinal).Where(g => g.Count() > 1))
            yield return new(CheckSeverity.Error, "model/duplicate-id",
                $"id '{group.Key}' is declared {group.Count()} times; whichever wins is arbitrary", group.Key);
    }

    private static IEnumerable<CheckFinding> DanglingLinkEndpoints(ArchModel model, HashSet<string> ids)
    {
        foreach (var link in model.Links)
        {
            if (!ids.Contains(link.FromId))
                yield return new(CheckSeverity.Error, "link/dangling-endpoint",
                    $"link '{link.Id}' starts at '{link.FromId}', which is not an element — the edge will not render", link.Id);
            if (!ids.Contains(link.ToId))
                yield return new(CheckSeverity.Error, "link/dangling-endpoint",
                    $"link '{link.Id}' ends at '{link.ToId}', which is not an element — the edge will not render", link.Id);
        }
    }

    /// <summary>`contextId`, `systemId` and `aboutId` are string references the compiler never sees.</summary>
    private static IEnumerable<CheckFinding> DanglingAttributeReferences(ArchModel model, HashSet<string> ids)
    {
        foreach (var e in model.Elements)
        {
            foreach (var attr in new[] { "contextId", "systemId", "aboutId" })
            {
                if (!e.Attributes.TryGetValue(attr, out var target) || string.IsNullOrEmpty(target)) continue;
                if (!ids.Contains(target))
                    yield return new(CheckSeverity.Error, "element/dangling-reference",
                        $"'{e.Id}' has {attr} '{target}', which is not an element", e.Id);
            }
        }
    }

    private static IEnumerable<CheckFinding> ViewFindings(string workspaceRoot, ArchModel model, HashSet<string> ids)
    {
        var viewsDir = Path.Combine(workspaceRoot, "Views");
        if (!Directory.Exists(viewsDir)) yield break;

        var docs = Directory.EnumerateFiles(viewsDir, "*.cs", SearchOption.AllDirectories)
            .Select(f => (FilePath: f, Root: (Microsoft.CodeAnalysis.SyntaxNode)CSharpSyntaxTree.ParseText(File.ReadAllText(f)).GetRoot()));

        foreach (var view in ViewsAdapter.ReadAllFrom(docs))
        {
            var members = view.ElementIds.Where(ids.Contains).ToList();

            foreach (var missing in view.ElementIds.Where(id => !ids.Contains(id)))
                yield return new(CheckSeverity.Error, "view/dangling-member",
                    $"view '{view.Id}' lists '{missing}', which is not an element", missing);

            if (members.Count == 0)
                yield return new(CheckSeverity.Error, "view/empty",
                    $"view '{view.Id}' resolves to no elements — a render of it has nothing to draw");
            else if (members.Count > BusyViewThreshold)
                yield return new(CheckSeverity.Warning, "view/busy",
                    $"view '{view.Id}' has {members.Count} elements; past {BusyViewThreshold} a diagram has usually stopped answering one question");

            // A view holding both Concepts and structural kinds is mixing rhetorical registers: half
            // the boxes claim something about a system and half claim nothing, and the picture reads
            // as neither an argument nor an architecture.
            var kinds = members.Select(id => model.Elements.First(e => e.Id == id).Kind).ToList();
            var conceptCount = kinds.Count(k => k == ArchElementKind.Concept);
            if (conceptCount > 0 && conceptCount < kinds.Count)
                yield return new(CheckSeverity.Warning, "view/mixed-register",
                    $"view '{view.Id}' mixes {conceptCount} Concept(s) with {kinds.Count - conceptCount} structural element(s); a diagram usually wants to be one or the other");

            // Links render only when *both* endpoints are in the view. A relationship that is in the
            // model and silently absent from the picture is the failure this catches: the diagram
            // looks fine and is missing an arrow the author believes is there.
            var present = members.ToHashSet(StringComparer.Ordinal);
            foreach (var link in model.Links)
            {
                if (present.Contains(link.FromId) ^ present.Contains(link.ToId))
                {
                    var absent = present.Contains(link.FromId) ? link.ToId : link.FromId;
                    yield return new(CheckSeverity.Info, "view/half-link",
                        $"view '{view.Id}' includes one end of link '{link.Id}' but not '{absent}', so that relationship will not be drawn");
                }
            }
        }
    }
}
