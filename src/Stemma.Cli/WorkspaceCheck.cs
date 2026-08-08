using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;

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

        return findings;
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
