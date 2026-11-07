using System.Diagnostics;
using System.Text.Json;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;

namespace Stemma.Cli;

/// <summary>
/// <c>stemma comments</c> — the review left on the cards, read and answered from the command line (F-027,
/// ADR-0031). Every write is one change to <c>comments.stemma.json</c> through the app's own writer, onto
/// the file as it is now; an open app shows it as it lands.
/// </summary>
public static class CommentsCommand
{
    public const string Usage = """
        stemma comments — read and answer the review comments left on a workspace's cards.

          stemma comments [list] [<path>] [--all] [--on <id>] [--json]
          stemma comments reply   <comment-id> <text> [--author <name>] [--workspace <path>]
          stemma comments resolve <comment-id> [<text>] [--author <name>] [--workspace <path>]
          stemma comments reopen  <comment-id> [--workspace <path>]
          stemma comments add --on <id> <text> [--author <name>] [--workspace <path>]

        list      The open comments, each with what it is on — named from the model — and its thread.
                  --all includes the resolved ones; --on <id> keeps one element's, link's or view's.
        reply     Add a reply to a comment's thread.
        resolve   Mark a comment resolved; with <text>, reply first, saying what was done.
        reopen    Mark a resolved comment open again.
        add       Start a comment on an element, a relationship or a view.

        <text> may be `-` to read it from standard input, for anything longer than a line.

        Who wrote it: --author, else $STEMMA_AUTHOR, else "Claude" when run inside Claude Code, else
        git's user.name, else "anonymous". An agent's reply should never read as the architect's.

        Exit codes
          0  done (list: whatever it found)
          2  the command line was wrong, or no such workspace, comment or target
          3  comments.stemma.json could not be read or written; nothing was changed
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

        var verb = args.Length > 0 && args[0] is "list" or "reply" or "resolve" or "reopen" or "add" ? args[0] : "list";
        var rest = verb == "list" && (args.Length == 0 || args[0] != "list") ? args : args.Skip(1).ToArray();

        string? workspaceFlag = null, author = null, on = null;
        bool all = false, json = false;
        var positional = new List<string>();
        for (var i = 0; i < rest.Length; i++)
        {
            switch (rest[i])
            {
                case "--workspace":
                    if (i + 1 >= rest.Length) return Fail("--workspace needs a path");
                    workspaceFlag = rest[++i];
                    break;
                case "--author":
                    if (i + 1 >= rest.Length) return Fail("--author needs a name");
                    author = rest[++i];
                    break;
                case "--on":
                    if (i + 1 >= rest.Length) return Fail("--on needs an id");
                    on = rest[++i];
                    break;
                case "--all": all = true; break;
                case "--json": json = true; break;
                default:
                    if (rest[i].StartsWith("--", StringComparison.Ordinal)) return Fail($"unknown option '{rest[i]}'");
                    positional.Add(rest[i]);
                    break;
            }
        }

        // `list` takes the workspace as its one word, as validate does; the others take words of their
        // own, so their workspace is only ever --workspace.
        string? workspaceWord = null;
        if (verb == "list")
        {
            if (positional.Count > 1) return Fail($"unexpected argument '{positional[1]}' — list reads one workspace");
            workspaceWord = positional.FirstOrDefault();
            if (workspaceWord is not null && workspaceFlag is not null) return Fail("name the workspace once, as a path or with --workspace");
        }
        var workspace = Path.GetFullPath(workspaceFlag ?? workspaceWord ?? Directory.GetCurrentDirectory());
        if (!Directory.Exists(workspace))
        {
            Console.Error.WriteLine($"stemma comments: no such workspace '{workspace}'");
            return 2;
        }

        IReadOnlyList<CommentsFile.Comment> comments;
        try { comments = CommentsFile.Read(workspace); }
        catch (SidecarPatchRefusedException e) { return Unreadable(e.Message); }
        catch (IOException e) { return Unreadable(e.Message); }
        catch (UnauthorizedAccessException e) { return Unreadable(e.Message); }

        if (verb == "list") return List(workspace, comments, all, on, json);

        var who = Author(author, workspace);
        switch (verb)
        {
            case "add":
            {
                if (on is null) return Fail("add needs --on <id>: the element, relationship or view the comment is on");
                if (positional.Count == 0) return Fail("add needs the comment's text");
                var text = Text(positional);
                if (text is null) return Fail("the comment's text is empty");
                var targets = new ReviewTargets(workspace);
                if (targets.TargetKindOf(on) is not { } targetKind)
                {
                    Console.Error.WriteLine($"stemma comments: '{on}' is not an element, a relationship or a view in {workspace}");
                    return 2;
                }
                var comment = new CommentsFile.Comment(CommentsFile.NewId(), targetKind, on, who, Now(), text, false, []);
                var added = await Patch(workspace, [new CommentChange.Add(CommentsFile.ToJson(comment))]);
                if (added != 0) return added;
                return Done(json, comment.Id, $"Added {comment.Id} on {targets.For(targetKind, on).Describe()}.");
            }
            case "reply":
            case "resolve":
            case "reopen":
            {
                if (positional.Count == 0) return Fail($"{verb} needs a comment id");
                var id = positional[0];
                var comment = comments.FirstOrDefault(c => c.Id == id);
                if (comment is null) return NoSuchComment(id, comments);
                var text = positional.Count > 1 ? Text(positional.Skip(1).ToList()) : null;
                if (verb == "reply" && text is null) return Fail("reply needs the reply's text");
                if (verb == "reopen" && positional.Count > 1) return Fail("reopen takes only the comment id");

                var changes = new List<CommentChange>();
                if (text is not null) changes.Add(new CommentChange.AddReply(id, CommentsFile.ToJson(new CommentsFile.Reply(who, Now(), text))));
                if (verb == "resolve") changes.Add(new CommentChange.SetResolved(id, true));
                if (verb == "reopen") changes.Add(new CommentChange.SetResolved(id, false));
                var patched = await Patch(workspace, changes);
                if (patched != 0) return patched;

                var target = new ReviewTargets(workspace).For(comment.TargetKind, comment.TargetId).Describe();
                return Done(json, id, verb switch
                {
                    "reply" => $"Replied to {id} on {target}.",
                    "resolve" => text is null ? $"Resolved {id} on {target}." : $"Replied to and resolved {id} on {target}.",
                    _ => $"Reopened {id} on {target}.",
                });
            }
        }
        return Fail($"unknown command '{verb}'");
    }

    private static int List(string workspace, IReadOnlyList<CommentsFile.Comment> comments, bool all, string? on, bool json)
    {
        var shown = comments.Where(c => (all || !c.Resolved) && (on is null || c.TargetId == on)).ToList();
        var targets = new ReviewTargets(workspace);
        var open = comments.Count(c => !c.Resolved);

        if (json)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                workspace,
                open,
                resolved = comments.Count - open,
                comments = shown.Select(c =>
                {
                    var t = targets.For(c.TargetKind, c.TargetId);
                    return new
                    {
                        id = c.Id,
                        target = new { kind = t.Kind, id = t.Id, name = t.Name, exists = t.Exists },
                        author = c.Author,
                        createdAt = c.CreatedAt,
                        body = c.Body,
                        resolved = c.Resolved,
                        thread = c.Thread.Select(r => new { author = r.Author, createdAt = r.CreatedAt, body = r.Body }),
                    };
                }),
            }, Indented));
            return 0;
        }

        var scope = on is null ? "" : $" on {on}";
        if (shown.Count == 0)
        {
            Console.WriteLine(all || open == 0
                ? $"stemma comments: no {(all ? "" : "open ")}comments{scope} in {Name(workspace)}"
                : $"stemma comments: no open comments{scope} in {Name(workspace)} ({open} open elsewhere)");
            return 0;
        }
        Console.WriteLine($"stemma comments: {shown.Count} {(all ? "" : "open ")}comment{(shown.Count == 1 ? "" : "s")}{scope} in {Name(workspace)}");
        foreach (var c in shown)
        {
            Console.WriteLine();
            Console.WriteLine($"{c.Id}{(c.Resolved ? "  [resolved]" : "")}  on {targets.For(c.TargetKind, c.TargetId).Describe()}");
            Console.WriteLine($"  {Who(c.Author)}, {When(c.CreatedAt)}:");
            foreach (var line in Lines(c.Body)) Console.WriteLine($"    {line}");
            foreach (var r in c.Thread)
            {
                Console.WriteLine($"  ↳ {Who(r.Author)}, {When(r.CreatedAt)}:");
                foreach (var line in Lines(r.Body)) Console.WriteLine($"      {line}");
            }
        }
        return 0;
    }

    /// <summary>The author chain of AC4: the flag, the variable, the agent, git, and only then nobody.</summary>
    internal static string Author(string? flag, string workspace)
    {
        if (!string.IsNullOrWhiteSpace(flag)) return flag.Trim();
        if (Environment.GetEnvironmentVariable("STEMMA_AUTHOR") is { Length: > 0 } named && named.Trim().Length > 0) return named.Trim();
        if (Environment.GetEnvironmentVariable("CLAUDECODE") is "1") return "Claude";
        return GitUserName(workspace) ?? "anonymous";
    }

    private static string? GitUserName(string workspace)
    {
        try
        {
            var psi = new ProcessStartInfo("git") { WorkingDirectory = workspace, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            foreach (var a in new[] { "config", "user.name" }) psi.ArgumentList.Add(a);
            psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
            using var p = Process.Start(psi);
            if (p is null) return null;
            var name = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit(5000);
            return p.ExitCode == 0 && name.Length > 0 ? name : null;
        }
        catch (System.ComponentModel.Win32Exception) { return null; }
    }

    private static async Task<int> Patch(string workspace, IReadOnlyList<CommentChange> changes)
    {
        OperationResult result;
        try { result = await CommentsFile.PatchAsync(workspace, changes); }
        catch (IOException e) { return Unreadable(e.Message); }
        catch (UnauthorizedAccessException e) { return Unreadable(e.Message); }
        if (result is not OperationFailed failed) return 0;
        if (failed.Reason == "NoSuchComment")
        {
            Console.Error.WriteLine($"stemma comments: {failed.Message}");
            return 2;
        }
        return Unreadable(failed.Message);
    }

    /// <summary>The words given, joined; `-` reads them from standard input. Null when there are none.</summary>
    private static string? Text(IReadOnlyList<string> words)
    {
        var text = words is ["-"] ? Console.In.ReadToEnd() : string.Join(' ', words);
        text = text.Trim();
        return text.Length == 0 ? null : text;
    }

    private static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);

    private static string Who(string author) => author.Length > 0 ? author : "anonymous";

    private static string When(string createdAt) =>
        DateTimeOffset.TryParse(createdAt, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var at)
            ? at.ToUniversalTime().ToString("d MMM yyyy HH:mm 'UTC'", System.Globalization.CultureInfo.InvariantCulture)
            : createdAt.Length > 0 ? createdAt : "no date";

    private static IEnumerable<string> Lines(string body) => body.Replace("\r\n", "\n").Split('\n');

    private static int Done(bool json, string id, string message)
    {
        if (json) Console.WriteLine(JsonSerializer.Serialize(new { ok = true, id, message }, Indented));
        else Console.WriteLine($"stemma comments: {message}");
        return 0;
    }

    private static int NoSuchComment(string id, IReadOnlyList<CommentsFile.Comment> comments)
    {
        var open = comments.Where(c => !c.Resolved).Select(c => c.Id).Take(10).ToList();
        Console.Error.WriteLine($"stemma comments: there is no comment '{id}'" +
            (open.Count == 0 ? " — and none is open" : $" (open: {string.Join(", ", open)}{(comments.Count(c => !c.Resolved) > open.Count ? ", …" : "")})"));
        return 2;
    }

    private static int Unreadable(string message)
    {
        Console.Error.WriteLine($"stemma comments: {message} Nothing was changed.");
        return 3;
    }

    /// <summary>The workspace's folder name, whether or not the path ends with a separator (`stemma diff ./`).</summary>
    private static string Name(string workspace) => Path.GetFileName(Path.TrimEndingDirectorySeparator(workspace));

    private static int Fail(string message)
    {
        Console.Error.WriteLine($"stemma comments: {message}");
        Console.Error.WriteLine();
        Console.Error.WriteLine(Usage);
        return 2;
    }
}
