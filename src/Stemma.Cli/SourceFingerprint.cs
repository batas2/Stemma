using System.Security.Cryptography;
using System.Text;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;

namespace Stemma.Cli;

/// <summary>
/// A fingerprint of everything that decides what a rendered diagram looks like.
///
/// The point of a model-backed diagram is that it cannot quietly stop matching its source — and that
/// guarantee ends at the app window unless the published file carries enough to check it. A PNG
/// committed beside a post is otherwise an ordinary image: nothing notices when the model moves on,
/// and the picture keeps making a claim that has stopped being true.
///
/// What goes in is deliberate. Element ids, names and kinds; link endpoints and kinds; the view's
/// membership; the layout constraint, offsets and positions for that view; the profile and palette.
/// What stays out is node *sizes*: they depend on the font, so including them would make the check
/// fail on a machine with different fonts installed, which is noise rather than drift. The trade is
/// recorded rather than hidden — a font change can alter the picture without the fingerprint
/// noticing, and that is the price of a check that is stable across machines.
/// </summary>
public static class SourceFingerprint
{
    public sealed record Fingerprint(string Hash, int Elements, int Links, int ViewMembers);

    public static Fingerprint For(string workspaceRoot, string viewId, string profile, string palette)
    {
        var sb = new StringBuilder();
        sb.Append("profile=").Append(profile).Append(";palette=").Append(palette).Append(";view=").Append(viewId).Append('\n');

        var archPath = Path.Combine(workspaceRoot, "Architecture", "Architecture.cs");
        ArchModel? model = null;
        if (File.Exists(archPath))
        {
            var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(archPath));
            model = DslReader.TryRead(archPath, tree.GetRoot());
        }

        var elements = 0;
        var links = 0;
        if (model is not null)
        {
            // Ordered, so the fingerprint describes the model rather than the order it was declared in.
            foreach (var e in model.Elements.OrderBy(e => e.Id, StringComparer.Ordinal))
            {
                sb.Append("e:").Append(e.Id).Append('|').Append(e.Kind).Append('|').Append(e.Name).Append('\n');
                elements++;
            }
            foreach (var l in model.Links.OrderBy(l => l.Id, StringComparer.Ordinal))
            {
                sb.Append("l:").Append(l.Id).Append('|').Append(l.Kind).Append('|').Append(l.FromId).Append("->").Append(l.ToId).Append('\n');
                links++;
            }
        }

        var members = 0;
        foreach (var view in ReadViews(workspaceRoot).Where(v => v.Id == viewId || v.Name == viewId))
        {
            foreach (var id in view.ElementIds.OrderBy(x => x, StringComparer.Ordinal))
            {
                sb.Append("m:").Append(id).Append('\n');
                members++;
            }
        }

        AppendLayout(sb, workspaceRoot, viewId);

        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())))[..16];
        return new Fingerprint(hash, elements, links, members);
    }

    private static IEnumerable<ArchView> ReadViews(string workspaceRoot)
    {
        var dir = Path.Combine(workspaceRoot, "Views");
        if (!Directory.Exists(dir)) return [];
        var docs = Directory.EnumerateFiles(dir, "*.cs", SearchOption.AllDirectories)
            .Select(f => (FilePath: f, Root: (Microsoft.CodeAnalysis.SyntaxNode)CSharpSyntaxTree.ParseText(File.ReadAllText(f)).GetRoot()));
        return ViewsAdapter.ReadAllFrom(docs);
    }

    /// <summary>
    /// The presentation half: positions, the constraint and any nudges for the view being rendered.
    /// Read as raw JSON rather than through the typed sidecar, because `layout` and `offsets` are
    /// pass-through members the engine deliberately does not model.
    /// </summary>
    private static void AppendLayout(StringBuilder sb, string workspaceRoot, string viewId)
    {
        var path = LayoutSidecar.PathFor(workspaceRoot);
        if (!File.Exists(path)) return;

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
            if (!doc.RootElement.TryGetProperty("views", out var views)) return;

            foreach (var key in new[] { $"custom:{viewId}", viewId })
            {
                if (!views.TryGetProperty(key, out var view)) continue;
                foreach (var member in new[] { "nodes", "layout", "offsets", "layoutMode" })
                    if (view.TryGetProperty(member, out var value))
                        sb.Append(member).Append(':').Append(value.GetRawText()).Append('\n');
                return;
            }
        }
        catch (System.Text.Json.JsonException)
        {
            // A sidecar that does not parse is a real state the canvas tolerates by ignoring it, so
            // the fingerprint does the same rather than failing a render over presentation.
            sb.Append("layout:unreadable\n");
        }
    }
}
