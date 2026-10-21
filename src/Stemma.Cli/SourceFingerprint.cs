using System.Security.Cryptography;
using System.Text;
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

    /// <param name="view">What `--view` was given: a view's id or its name, or a lens.</param>
    public static Fingerprint For(string workspaceRoot, string view, string profile, string palette)
    {
        // A view is named by its id or its name, and its layout is kept under its id. Resolved first,
        // so a view checked by name finds its layout, and by either it is the same picture.
        var views = WorkspaceViews.Read(workspaceRoot).Select(v => v.View).ToList();
        var match = views.FirstOrDefault(v => v.Id == view) ?? views.FirstOrDefault(v => v.Name == view);
        var viewId = match?.Id ?? view;

        var sb = new StringBuilder();
        sb.Append("profile=").Append(profile).Append(";palette=").Append(palette).Append(";view=").Append(viewId).Append('\n');

        // Every model file, merged as the engine merges them: a rename in Payments.cs is as much a
        // change to the picture as one in Architecture.cs.
        var model = ArchModelMerge.ReadFrom(workspaceRoot).Model;

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
        foreach (var id in match?.ElementIds.OrderBy(x => x, StringComparer.Ordinal) ?? Enumerable.Empty<string>())
        {
            sb.Append("m:").Append(id).Append('\n');
            members++;
        }

        AppendLayout(sb, workspaceRoot, match is null ? null : $"custom:{match.Id}", view);

        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())))[..16];
        return new Fingerprint(hash, elements, links, members);
    }

    /// <summary>
    /// The presentation half: positions, the constraint and any nudges for the view being rendered.
    /// Read as raw JSON rather than through the typed sidecar, because `layout` and `offsets` are
    /// pass-through members the engine deliberately does not model.
    /// </summary>
    /// <param name="customKey">The code view's key under <c>views</c>, when the view is one.</param>
    /// <param name="lens">What `--view` was given, which is the key when it names a lens.</param>
    private static void AppendLayout(StringBuilder sb, string workspaceRoot, string? customKey, string lens)
    {
        var path = LayoutSidecar.PathFor(workspaceRoot);
        if (!File.Exists(path)) return;

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
            if (!doc.RootElement.TryGetProperty("views", out var views) || views.ValueKind != System.Text.Json.JsonValueKind.Object) return;

            foreach (var key in new[] { customKey, lens }.OfType<string>())
            {
                if (!views.TryGetProperty(key, out var view) || view.ValueKind != System.Text.Json.JsonValueKind.Object) continue;
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
