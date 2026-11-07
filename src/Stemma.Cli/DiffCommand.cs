using System.Text;
using System.Text.Json;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;
using Stemma.Web.Services;

namespace Stemma.Cli;

/// <summary>
/// <c>stemma diff</c> — what a change did to the model, in the model's own words (F-027, ADR-0031): the
/// working tree compared with a revision read from Git, element by element and link by link, by the
/// comparison the app's <i>What changed</i> uses; and the review comments opened and resolved since.
/// Nothing is written.
/// </summary>
public static class DiffCommand
{
    public const string Usage = """
        stemma diff — what changed in the model since a revision, in the model's own words.

          stemma diff [<path>] [--workspace <path>] [--base <rev>] [--markdown | --json]

        Compares the model in the working tree, saved but not necessarily committed, with the model at a
        revision: by default where the current branch started from the default branch — what a pull
        request would change — or, on the default branch itself, the last commit. Says what was added,
        removed and changed, and which review comments were opened and resolved since.

        Options
          <path>, --workspace <path>
                       Workspace root, either way. Defaults to the current directory.
          --base <rev> The revision to compare with: a branch, a tag, a commit, HEAD~3.
          --markdown   A section for a pull request's description.
          --json       Machine-readable output.

        Exit codes
          0  compared (whether or not anything changed)
          2  the command line was wrong, the workspace has no model, it is not in a Git repository, or
             there is no such revision
          3  the comparison could not run: a file in the workspace could not be read
        """;

    // Names and comments are read by people and agents as they are printed: “Checkout”, not \u201CCheckout\u201D.
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Contains("--help") || args.Contains("-h"))
        {
            Console.WriteLine(Usage);
            return 0;
        }

        string? flagged = null, positional = null, baseRev = null;
        bool json = false, markdown = false;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--workspace":
                    if (i + 1 >= args.Length) return Fail("--workspace needs a path");
                    flagged = args[++i];
                    break;
                case "--base":
                    if (i + 1 >= args.Length) return Fail("--base needs a revision");
                    baseRev = args[++i];
                    break;
                case "--json": json = true; break;
                case "--markdown": markdown = true; break;
                default:
                    if (args[i].StartsWith('-')) return Fail($"unknown option '{args[i]}'");
                    if (positional is not null) return Fail($"unexpected argument '{args[i]}' — diff compares one workspace");
                    positional = args[i];
                    break;
            }
        }
        if (json && markdown) return Fail("--json and --markdown are two outputs; choose one");
        if (flagged is not null && positional is not null) return Fail("name the workspace once, as a path or with --workspace");

        var workspace = Path.GetFullPath(flagged ?? positional ?? Directory.GetCurrentDirectory());
        if (!Directory.Exists(workspace))
        {
            Console.Error.WriteLine($"stemma diff: no such workspace '{workspace}'");
            return 2;
        }
        try { return await CompareAsync(workspace, baseRev, json, markdown); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"stemma diff: could not read '{workspace}': {e.Message}");
            return 3;
        }
    }

    private static async Task<int> CompareAsync(string workspace, string? baseRev, bool json, bool markdown)
    {
        var after = ArchModelMerge.ReadFrom(workspace).Model;
        if (after is null)
        {
            Console.Error.WriteLine($"stemma diff: '{workspace}' has no model — no file in Architecture/ with a `public static Model Build()`");
            return 2;
        }

        // What to compare with: the revision asked for, else where this branch started, else the last commit.
        var history = await GitHistory.ReadAsync(workspace);
        if (!history.Repository)
        {
            Console.Error.WriteLine($"stemma diff: {history.Reason ?? "this workspace is not in a Git repository."}");
            return 2;
        }
        string rev, since;
        if (baseRev is not null) (rev, since) = (baseRev, baseRev);
        else if (history.MergeBase is { } mergeBase) (rev, since) = (mergeBase, $"where {history.Branch} started from {history.DefaultBranch}");
        else (rev, since) = ("HEAD", "the last commit");

        GitHistory.ModelAt then;
        string? commentsThen;
        try
        {
            then = await GitHistory.ModelAtAsync(workspace, rev);
            commentsThen = await GitHistory.FileAtAsync(workspace, then.Sha, CommentsSidecar.FileName);
        }
        catch (GitHistory.RevisionNotFound e)
        {
            Console.Error.WriteLine($"stemma diff: {e.Message}");
            return 2;
        }

        var changes = ModelDiff.Compare(then.Arch, after);
        var review = Review(workspace, commentsThen);
        var report = new Report(workspace, rev, then.Sha, since, then.Arch, after, changes, review);

        if (json) Console.WriteLine(Json(report));
        else Console.Write(markdown ? Markdown(report) : Text(report));
        return 0;
    }

    private sealed record ReviewChanges(
        IReadOnlyList<CommentsFile.Comment> Opened, IReadOnlyList<CommentsFile.Comment> Resolved, int StillOpen, string? Unreadable);

    private sealed record Report(
        string Workspace, string Rev, string Sha, string Since, ArchModel? Before, ArchModel After, ModelChanges Changes, ReviewChanges Review);

    /// <summary>Comments that are new since, and comments open then and resolved now — or new and already resolved.</summary>
    private static ReviewChanges Review(string workspace, string? textThen)
    {
        IReadOnlyList<CommentsFile.Comment> now, then;
        try { now = CommentsFile.Read(workspace); }
        catch (SidecarPatchRefusedException e) { return new([], [], 0, e.Message); }
        try { then = textThen is null ? [] : CommentsFile.Parse(textThen); }
        catch (SidecarPatchRefusedException) { then = []; }

        var thenById = then.GroupBy(c => c.Id).ToDictionary(g => g.Key, g => g.First());
        var opened = now.Where(c => !thenById.ContainsKey(c.Id) && !c.Resolved).ToList();
        var resolved = now.Where(c => c.Resolved && (!thenById.TryGetValue(c.Id, out var was) || !was.Resolved)).ToList();
        return new(opened, resolved, now.Count(c => !c.Resolved), null);
    }

    // ---------------------------------------------------------------- text

    /// <summary>How a line is written: plain for a terminal; escaped, with ids as code, for Markdown.</summary>
    private sealed record Style(Func<string, string> Text, Func<string, string> Id)
    {
        public static readonly Style Plain = new(t => t, id => $"({id})");
        public static readonly Style Markdown = new(Escape, id => $"(`{id}`)");
    }

    private static string Text(Report r)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"stemma diff: {Name(r.Workspace)} since {r.Since} ({Short(r.Sha)}) — {ModelDiff.DescribeCounts(r.Changes)}");
        if (r.Before is null) sb.AppendLine("  (there was no model at that revision: everything is new)");
        foreach (var (title, lines) in Sections(r, Style.Plain).Concat(ReviewSections(r, Style.Plain)))
        {
            sb.AppendLine();
            sb.AppendLine(title);
            foreach (var line in lines) sb.AppendLine($"  {line}");
        }
        return sb.ToString();
    }

    private static string Markdown(Report r)
    {
        var sb = new StringBuilder();
        sb.AppendLine("### Architecture changes");
        sb.AppendLine();
        sb.AppendLine($"Compared with {Escape(r.Since)} (`{Short(r.Sha)}`): **{ModelDiff.DescribeCounts(r.Changes)}**.");
        if (r.Before is null) sb.AppendLine("There was no model at that revision, so everything is new.");
        foreach (var (title, lines) in Sections(r, Style.Markdown).Concat(ReviewSections(r, Style.Markdown)))
        {
            sb.AppendLine();
            sb.AppendLine($"**{title}**");
            sb.AppendLine();
            foreach (var line in lines) sb.AppendLine($"- {line}");
        }
        sb.AppendLine();
        sb.AppendLine("<sub>Written by `stemma diff`.</sub>");
        return sb.ToString();
    }

    /// <summary>Added, removed and changed, each a list of lines: the element or link, then what changed about it.</summary>
    private static IEnumerable<(string Title, IReadOnlyList<string> Lines)> Sections(Report r, Style style)
    {
        var namesBefore = Names(r.Before);
        var namesAfter = Names(r.After);
        string Name(string id) => namesAfter.TryGetValue(id, out var n) || namesBefore.TryGetValue(id, out n) ? n : id;

        string Element(ArchElement e) => $"{style.Text($"{ModelDiff.KindLabel(e.Kind)} {ModelDiff.Quoted(e.Name)}")} {style.Id(e.Id)}";
        string Link(ArchLink l) => $"{style.Text($"{LinkKind(l.Kind)} {ModelDiff.DescribeLink(l, Name)}")} {style.Id(l.Id)}";
        string Line(string what, IReadOnlyList<string> details) => details.Count == 0 ? what : $"{what}: {style.Text(string.Join("; ", details))}";

        foreach (var (kind, title) in new[] { (ChangeKind.Added, "Added"), (ChangeKind.Removed, "Removed"), (ChangeKind.Changed, "Changed") })
        {
            var lines = r.Changes.Elements.Where(c => c.Change == kind)
                .Select(c => Line(Element(c.Element), c.Details))
                .Concat(r.Changes.Links.Where(c => c.Change == kind).Select(c => Line(Link(c.Link), c.Details)))
                .ToList();
            if (lines.Count > 0) yield return ($"{title} ({lines.Count})", lines);
        }
    }

    private static IEnumerable<(string Title, IReadOnlyList<string> Lines)> ReviewSections(Report r, Style style)
    {
        var review = r.Review;
        if (review.Unreadable is not null)
        {
            yield return ("Review comments", [style.Text($"comments.stemma.json could not be read: {review.Unreadable}")]);
            yield break;
        }
        if (review.Opened.Count == 0 && review.Resolved.Count == 0) yield break;
        var targets = new ReviewTargets(r.Workspace);
        string Line(CommentsFile.Comment c) =>
            $"{Capital(targets.For(c.TargetKind, c.TargetId).Describe(style.Text, style.Id))} — {style.Text($"{Who(c.Author)}: {Summary(c.Body)}")}";
        if (review.Resolved.Count > 0) yield return ($"Review comments resolved ({review.Resolved.Count})", review.Resolved.Select(Line).ToList());
        if (review.Opened.Count > 0) yield return ($"Review comments opened ({review.Opened.Count})", review.Opened.Select(Line).ToList());
    }

    // ---------------------------------------------------------------- json

    private static string Json(Report r) => JsonSerializer.Serialize(new
    {
        workspace = r.Workspace,
        @base = new { rev = r.Rev, sha = r.Sha, since = r.Since, hadModel = r.Before is not null },
        counts = new { added = r.Changes.Added, removed = r.Changes.Removed, changed = r.Changes.Changed, total = r.Changes.Total },
        summary = ModelDiff.DescribeCounts(r.Changes),
        elements = r.Changes.Elements.Select(c => new
        {
            id = c.Id, change = Camel(c.Change.ToString()), kind = Camel(c.Element.Kind.ToString()), name = c.Element.Name, details = c.Details,
        }),
        links = r.Changes.Links.Select(c => new
        {
            id = c.Id, change = Camel(c.Change.ToString()), kind = Camel(c.Link.Kind.ToString()), fromId = c.Link.FromId, toId = c.Link.ToId, details = c.Details,
        }),
        comments = new
        {
            unreadable = r.Review.Unreadable,
            stillOpen = r.Review.StillOpen,
            resolved = r.Review.Resolved.Select(c => new { id = c.Id, targetId = c.TargetId, author = c.Author, body = c.Body }),
            opened = r.Review.Opened.Select(c => new { id = c.Id, targetId = c.TargetId, author = c.Author, body = c.Body }),
        },
    }, Indented);

    // ---------------------------------------------------------------- helpers

    private static Dictionary<string, string> Names(ArchModel? model)
    {
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var e in model?.Elements ?? []) names.TryAdd(e.Id, e.Name);
        return names;
    }

    private static string LinkKind(ArchLinkKind kind) => kind switch
    {
        ArchLinkKind.DataFlow => "Data flow",
        ArchLinkKind.Dependency => "Dependency",
        _ => "Relation",
    };

    /// <summary>The first line of a comment, cut at a readable length.</summary>
    private static string Summary(string body)
    {
        var first = body.Replace("\r\n", "\n").Split('\n')[0].Trim();
        return first.Length <= 100 ? first : first[..97].TrimEnd() + "…";
    }

    private static string Who(string author) => author.Length > 0 ? author : "anonymous";

    /// <summary>A line's first letter in upper case: a kind is written in lower case for the middle of a sentence.</summary>
    private static string Capital(string text) => text.Length == 0 ? text : char.ToUpperInvariant(text[0]) + text[1..];

    private static string Short(string sha) => sha.Length > 7 ? sha[..7] : sha;

    /// <summary>Markdown's own characters in a model's names, so a name with an asterisk stays a name.</summary>
    private static string Escape(string text)
    {
        var sb = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            if (ch is '\\' or '*' or '_' or '`' or '[' or ']' or '<' or '>' or '#' or '|') sb.Append('\\');
            sb.Append(ch);
        }
        return sb.ToString();
    }

    private static string Camel(string name) => char.ToLowerInvariant(name[0]) + name[1..];

    /// <summary>The workspace's folder name, whether or not the path ends with a separator (`stemma diff ./`).</summary>
    private static string Name(string workspace) => Path.GetFileName(Path.TrimEndingDirectorySeparator(workspace));

    private static int Fail(string message)
    {
        Console.Error.WriteLine($"stemma diff: {message}");
        Console.Error.WriteLine();
        Console.Error.WriteLine(Usage);
        return 2;
    }
}
