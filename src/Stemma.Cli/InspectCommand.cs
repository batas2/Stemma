using System.Text.Json;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Validation;

namespace Stemma.Cli;

/// <summary>
/// `stemma inspect --view` — what a view draws, and why.
///
/// A view by rule is not readable off its file at a glance: "the containers of the platform and
/// whatever talks to them" is one line, and which twelve boxes that is depends on the model today
/// (ADR-0026). This prints the answer the canvas and the render use — every member and what brought it
/// in, the links drawn, the links implied through a container shown as its system and the ones they
/// stand for, and the relationships left out — so an agent can check a rule did what it meant without
/// rendering a picture it cannot count.
/// </summary>
public static class InspectCommand
{
    public const string Usage = """
        stemma inspect — what a view draws, and why.

          stemma inspect --view <id|name> [<path>] [--workspace <path>] [--json]

        Lists the view's members and what brought each one in (its lens, its ElementIds, or the Include
        selector that selected it), the links it draws, the links it implies through a container drawn
        as its system, and the relationships it leaves out because only one end is in the view.

        Options
          --view <id|name>     The view, by the id its Define() declares or by its name.
          <path>, --workspace <path>
                               Workspace root, either way. Defaults to the current directory.
          --json               Machine-readable output.

        Exit codes
          0  the view resolves with nothing wrong in how it is written
          1  the view has an error: a scope, a rule or a member that names nothing
          2  the command line was wrong, or the workspace or the view does not exist
          3  the view could not be read (a file that could not be opened, say)
        """;

    public static Task<int> RunAsync(string[] args)
    {
        if (args.Contains("--help") || args.Contains("-h"))
        {
            Console.WriteLine(Usage);
            return Task.FromResult(0);
        }

        string? viewName = null, flagged = null, positional = null;
        var json = false;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--view":
                    if (i + 1 >= args.Length) return Fail("--view needs a view id or name");
                    viewName = args[++i];
                    break;
                case "--workspace":
                    if (i + 1 >= args.Length) return Fail("--workspace needs a path");
                    flagged = args[++i];
                    break;
                case "--json": json = true; break;
                default:
                    if (args[i].StartsWith('-')) return Fail($"unknown option '{args[i]}'");
                    if (positional is not null) return Fail($"unexpected argument '{args[i]}' — inspect looks at one workspace");
                    positional = args[i];
                    break;
            }
        }
        if (viewName is null) return Fail("which view? --view <id|name>");
        if (flagged is not null && positional is not null
            && Path.TrimEndingDirectorySeparator(Path.GetFullPath(flagged)) != Path.TrimEndingDirectorySeparator(Path.GetFullPath(positional)))
            return Fail($"two workspaces given, '{positional}' and --workspace '{flagged}' — name one");

        var workspace = Path.GetFullPath(flagged ?? positional ?? Directory.GetCurrentDirectory());
        if (!Directory.Exists(workspace))
        {
            Console.Error.WriteLine($"stemma inspect: no such workspace '{workspace}'");
            return Task.FromResult(2);
        }

        try
        {
            return Task.FromResult(Inspect(workspace, viewName, json));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"stemma inspect: could not read '{workspace}': {e.Message}");
            return Task.FromResult(3);
        }
    }

    private static int Inspect(string workspace, string viewName, bool json)
    {
        var model = ArchModelMerge.ReadFrom(workspace).Model;
        if (model is null)
        {
            Console.Error.WriteLine($"stemma inspect: '{workspace}' has no model — no file in Architecture/ with a `public static Model Build()`");
            return 2;
        }

        var views = WorkspaceViews.Read(workspace).Select(v => v.View).ToList();
        var view = views.FirstOrDefault(v => v.Id == viewName) ?? views.FirstOrDefault(v => v.Name == viewName);
        if (view is null)
        {
            Console.Error.WriteLine($"stemma inspect: no view '{viewName}' in {workspace}" +
                (views.Count == 0 ? " — it has no views" : $" (views: {string.Join(", ", views.Select(v => v.Id).Order(StringComparer.Ordinal))})"));
            return 2;
        }

        var resolved = ViewProjection.Resolve(view, model);
        var elements = model.Elements.GroupBy(e => e.Id, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var links = model.Links.GroupBy(l => l.Id, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var members = resolved.Members.ToHashSet(StringComparer.Ordinal);

        if (json) WriteJson(workspace, view, resolved, elements, links, members);
        else WriteText(view, resolved, elements, links, members);
        return resolved.Problems.Any(p => p.Severity == Severity.Error) ? 1 : 0;
    }

    private static void WriteJson(string workspace, ArchView view, ViewResolution resolved,
        Dictionary<string, ArchElement> elements, Dictionary<string, ArchLink> links, HashSet<string> members)
    {
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            workspace,
            view = new { id = view.Id, name = view.Name, baseView = view.BaseView, elementIds = view.ElementIds, scope = view.Scope, include = view.Include, exclude = view.Exclude },
            members = resolved.Members.Select(id => new { id, name = elements[id].Name, kind = Camel(elements[id].Kind.ToString()), provenance = resolved.Provenance[id] }),
            links = resolved.LinkIds.Select(id => links[id]).Select(l => new { id = l.Id, kind = Camel(l.Kind.ToString()), fromId = l.FromId, toId = l.ToId, label = LabelOf(l) }),
            implied = resolved.Implied.Select(i => new
            {
                id = i.Id, fromId = i.FromId, toId = i.ToId, linkIds = i.LinkIds,
                labels = i.LinkIds.Select(id => LabelOf(links[id])).Where(label => label.Length > 0).Distinct(),
            }),
            leftOut = resolved.LeftOut.Select(id => links[id]).Select(l => new
            {
                id = l.Id, kind = Camel(l.Kind.ToString()), fromId = l.FromId, toId = l.ToId, label = LabelOf(l),
                absent = members.Contains(l.FromId) ? l.ToId : l.FromId,
            }),
            problems = resolved.Problems.Select(p => new { rule = p.Rule, severity = p.Severity.ToString().ToLowerInvariant(), message = p.Message }),
        }, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static void WriteText(ArchView view, ViewResolution resolved,
        Dictionary<string, ArchElement> elements, Dictionary<string, ArchLink> links, HashSet<string> members)
    {
        var lens = view.BaseView + (string.IsNullOrEmpty(view.Scope) ? "" : $", scope {view.Scope}");
        Console.WriteLine($"stemma inspect: {view.Id} \"{view.Name}\" — {lens}");

        Section($"Members ({resolved.Members.Count})", resolved.Members.Select(id =>
            $"{id,-24} {elements[id].Kind,-15} {resolved.Provenance[id]}"));
        Section($"Links drawn ({resolved.LinkIds.Count})", resolved.LinkIds.Select(id => links[id]).Select(l =>
            $"{l.Id,-24} {l.FromId} -> {l.ToId}{Quoted(LabelOf(l))}"));
        Section($"Implied links ({resolved.Implied.Count})", resolved.Implied.Select(i =>
            $"{i.FromId} -> {i.ToId}, for {string.Join(", ", i.LinkIds.Select(id => $"{id}{Quoted(LabelOf(links[id]))}"))}"));
        Section($"Left out ({resolved.LeftOut.Count})", resolved.LeftOut.Select(id => links[id]).Select(l =>
            $"{l.Id,-24} {l.FromId} -> {l.ToId}{Quoted(LabelOf(l))}: '{(members.Contains(l.FromId) ? l.ToId : l.FromId)}' is not in the view"));
        if (resolved.Problems.Count > 0)
            Section($"Problems ({resolved.Problems.Count})", resolved.Problems.Select(p =>
                $"{p.Severity.ToString().ToLowerInvariant(),-7} {p.Rule,-22} {p.Message}"));

        static void Section(string title, IEnumerable<string> lines)
        {
            Console.WriteLine();
            Console.WriteLine(title);
            foreach (var line in lines) Console.WriteLine($"  {line}");
        }
        static string Quoted(string label) => label.Length == 0 ? "" : $"  \"{label}\"";
    }

    /// <summary>What a link says on the canvas: a flow's payload and technology, a dependency's kind, a relation's label.</summary>
    private static string LabelOf(ArchLink link)
    {
        string? Get(string key) => link.Attributes.GetValueOrDefault(key);
        return link.Kind switch
        {
            ArchLinkKind.DataFlow when Get("technology") is { Length: > 0 } tech => $"{Get("payload")} [{tech}]",
            ArchLinkKind.DataFlow => Get("payload") ?? "",
            ArchLinkKind.Dependency => Get("kind") ?? "uses",
            _ => Get("label") ?? "",
        };
    }

    private static string Camel(string name) => char.ToLowerInvariant(name[0]) + name[1..];

    private static Task<int> Fail(string message)
    {
        Console.Error.WriteLine($"stemma inspect: {message}");
        Console.Error.WriteLine();
        Console.Error.WriteLine(Usage);
        return Task.FromResult(2);
    }
}
