using System.Diagnostics;
using System.Text.Json;
using FluentAssertions;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// `stemma comments` and `stemma diff` (F-027), run as the shipped command on a scratch workspace in a
/// scratch repository. Every variable that decides who a reply is from, and every piece of the machine's
/// git configuration, is set here: a test that read them from this machine would pass here and nowhere
/// else (B-017) — and would pass as "Claude" whenever it was run from inside Claude Code.
/// </summary>
public sealed class ReviewLoopCommandTests : IDisposable
{
    private readonly string _root = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-review-{Guid.NewGuid():N}")).FullName;

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private const string Model = """
        using Stemma.Model;

        namespace Shop;

        public static class Architecture
        {
            public static Model Build()
            {
                var sysShop = new SoftwareSystem("sys_shop", "Shop");
                var cntApi = new Container("cnt_api", "API", "sys_shop", "service", ".NET 8");
                var cntDb = new Container("cnt_db", "Orders DB", "sys_shop", "db");
                var flowSave = new DataFlow("flow_save", "cnt_api", "cnt_db", "Orders", Technology: "SQL");
                return Model.Of(sysShop, cntApi, cntDb, flowSave);
            }
        }
        """;

    private const string View = """
        using Stemma.Model;

        namespace Shop.Views;

        public static class Containers
        {
            public static View Define() => new(
                Id: "view_containers",
                Name: "Inside the shop",
                BaseView: "container",
                Scope: "sys_shop");
        }
        """;

    private string Ws => Path.Combine(_root, "ws");
    private string CommentsPath => CommentsSidecar.PathFor(Ws);

    private void Workspace(string model = Model)
    {
        Directory.CreateDirectory(Path.Combine(Ws, "Architecture"));
        Directory.CreateDirectory(Path.Combine(Ws, "Views"));
        File.WriteAllText(Path.Combine(Ws, "Architecture", "Architecture.cs"), model);
        File.WriteAllText(Path.Combine(Ws, "Views", "Containers.cs"), View);
    }

    private const string Comments = """
        {
          "version": 1,
          "comments": [
            { "id": "c_async", "targetKind": "element", "targetId": "flow_save", "author": "Aria", "createdAt": "2026-11-01T10:00:00.000Z", "body": "Should saving be asynchronous?", "resolved": false, "thread": [] },
            { "id": "c_gone", "targetKind": "element", "targetId": "cnt_cache", "author": "Aria", "createdAt": "2026-11-01T10:01:00.000Z", "body": "Who owns the cache?", "resolved": false, "thread": [] },
            { "id": "c_done", "targetKind": "view", "targetId": "view_containers", "author": "Aria", "createdAt": "2026-11-01T10:02:00.000Z", "body": "Title says it.", "resolved": true, "thread": [] }
          ]
        }

        """;

    private (int ExitCode, string Output, string Error) Stemma(IDictionary<string, string?>? env, params string[] args)
    {
        var psi = SiblingProgram.StartInfo(Path.Combine(AppContext.BaseDirectory, "stemma.dll"));
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardInput = true;
        psi.WorkingDirectory = Ws;
        foreach (var a in args) psi.ArgumentList.Add(a);
        Isolate(psi);
        psi.Environment.Remove("CLAUDECODE");
        psi.Environment.Remove("STEMMA_AUTHOR");
        foreach (var (k, v) in env ?? new Dictionary<string, string?>())
            if (v is null) psi.Environment.Remove(k); else psi.Environment[k] = v;
        using var p = Process.Start(psi)!;
        p.StandardInput.Close();
        var error = p.StandardError.ReadToEndAsync();
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return (p.ExitCode, output.Trim(), error.Result.Trim());
    }

    private (int ExitCode, string Output, string Error) Stemma(params string[] args) => Stemma(null, args);

    /// <summary>No configuration of this machine's: a global file that does not exist, no system one, a name given here.</summary>
    private void Isolate(ProcessStartInfo psi)
    {
        psi.Environment["GIT_CONFIG_GLOBAL"] = Path.Combine(_root, ".no-global-config");
        psi.Environment["GIT_CONFIG_NOSYSTEM"] = "1";
        psi.Environment["GIT_AUTHOR_NAME"] = "Aria";
        psi.Environment["GIT_AUTHOR_EMAIL"] = "aria@example.com";
        psi.Environment["GIT_COMMITTER_NAME"] = "Aria";
        psi.Environment["GIT_COMMITTER_EMAIL"] = "aria@example.com";
    }

    private void Git(params string[] args)
    {
        var psi = new ProcessStartInfo("git") { WorkingDirectory = Ws, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        Isolate(psi);
        using var p = Process.Start(psi)!;
        p.WaitForExit();
        p.ExitCode.Should().Be(0, $"git {string.Join(' ', args)}: {p.StandardError.ReadToEnd()}");
    }

    private static bool GitAvailable()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("git", "--version") { RedirectStandardOutput = true, UseShellExecute = false });
            p!.WaitForExit();
            return p.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception) { return false; }
    }

    private CommentsFile.Comment Read(string id) => CommentsFile.Read(Ws).Single(c => c.Id == id);

    // ---------------------------------------------------------------- comments

    [Fact]
    public void The_open_comments_are_listed_with_what_each_is_on_named_from_the_model()
    {
        Workspace();
        File.WriteAllText(CommentsPath, Comments);

        var (exit, output, _) = Stemma("comments");

        exit.Should().Be(0);
        output.Should().StartWith("stemma comments: 2 open comments in ws");
        output.Should().Contain("c_async  on data flow “API → Orders DB · Orders” (flow_save)");
        output.Should().Contain("Should saving be asynchronous?");
        output.Should().Contain("c_gone  on cnt_cache, no longer in the model");
        output.Should().NotContain("c_done", "a resolved comment is listed only with --all");

        Stemma("comments", "--all").Output.Should().Contain("c_done  [resolved]  on view “Inside the shop” (view_containers)");
        Stemma("comments", "--on", "cnt_cache").Output.Should().Contain("c_gone").And.NotContain("c_async");
    }

    [Fact]
    public void The_json_carries_the_target_kind_name_and_whether_it_still_exists()
    {
        Workspace();
        File.WriteAllText(CommentsPath, Comments);

        var (exit, output, _) = Stemma("comments", "--json");

        exit.Should().Be(0);
        using var json = JsonDocument.Parse(output);
        json.RootElement.GetProperty("open").GetInt32().Should().Be(2);
        json.RootElement.GetProperty("resolved").GetInt32().Should().Be(1);
        var first = json.RootElement.GetProperty("comments")[0];
        first.GetProperty("id").GetString().Should().Be("c_async");
        first.GetProperty("target").GetProperty("kind").GetString().Should().Be("dataFlow");
        first.GetProperty("target").GetProperty("exists").GetBoolean().Should().BeTrue();
        json.RootElement.GetProperty("comments")[1].GetProperty("target").GetProperty("exists").GetBoolean().Should().BeFalse();
        output.Should().Contain("API → Orders DB", "names are printed as they read, not as \\u escapes");
    }

    [Fact]
    public void A_reply_and_a_resolution_are_written_onto_the_file_as_it_is()
    {
        Workspace();
        File.WriteAllText(CommentsPath, Comments);

        Stemma("comments", "reply", "c_async", "Made", "it", "a", "queue.", "--author", "Claude").ExitCode.Should().Be(0);
        var (exit, output, _) = Stemma("comments", "resolve", "c_async", "Done: flow_save now goes through a queue.", "--author", "Claude");

        exit.Should().Be(0);
        output.Should().Be("stemma comments: Replied to and resolved c_async on data flow “API → Orders DB · Orders” (flow_save).");
        var c = Read("c_async");
        c.Resolved.Should().BeTrue();
        c.Thread.Select(r => (r.Author, r.Body)).Should().Equal(("Claude", "Made it a queue."), ("Claude", "Done: flow_save now goes through a queue."));
        // The other comments, and how the file was written, are not touched.
        File.ReadAllText(CommentsPath).Should().Contain("{ \"id\": \"c_gone\", \"targetKind\": \"element\"");

        Stemma("comments", "reopen", "c_async").ExitCode.Should().Be(0);
        Read("c_async").Resolved.Should().BeFalse();
    }

    [Fact]
    public void A_comment_is_started_on_an_element_a_relationship_or_a_view_and_nothing_else()
    {
        Workspace();

        Stemma("comments", "add", "--on", "cnt_db", "Is this one database or two?", "--author", "Claude").ExitCode.Should().Be(0);
        Stemma("comments", "add", "--on", "view_containers", "Missing the queue.", "--author", "Claude").ExitCode.Should().Be(0);
        var (exit, _, error) = Stemma("comments", "add", "--on", "cnt_nope", "?");

        exit.Should().Be(2);
        error.Should().Contain("'cnt_nope' is not an element, a relationship or a view");
        var all = CommentsFile.Read(Ws);
        all.Select(c => (c.TargetKind, c.TargetId, c.Author, c.Resolved)).Should().Equal(
            ("element", "cnt_db", "Claude", false), ("view", "view_containers", "Claude", false));
    }

    [Fact]
    public void An_unknown_comment_is_refused_with_the_open_ones_named()
    {
        Workspace();
        File.WriteAllText(CommentsPath, Comments);

        var (exit, _, error) = Stemma("comments", "resolve", "c_nope");

        exit.Should().Be(2);
        error.Should().Contain("there is no comment 'c_nope' (open: c_async, c_gone)");
        File.ReadAllText(CommentsPath).Should().Be(Comments);
    }

    [Fact]
    public void A_comments_file_a_merge_broke_is_refused_and_left_alone()
    {
        Workspace();
        var broken = Comments.Replace("  \"comments\": [", "<<<<<<< HEAD\n  \"comments\": [");
        File.WriteAllText(CommentsPath, broken);

        Stemma("comments").ExitCode.Should().Be(3);
        var (exit, _, error) = Stemma("comments", "reply", "c_async", "?");

        exit.Should().Be(3);
        error.Should().Contain("Nothing was changed.");
        File.ReadAllText(CommentsPath).Should().Be(broken);
    }

    [Fact]
    public void The_author_is_the_flag_then_the_variable_then_the_agent_then_git()
    {
        Workspace();
        File.WriteAllText(CommentsPath, Comments);
        Git("init", "-q", "-b", "main");
        Git("config", "user.name", "Aria from git");

        Stemma(new Dictionary<string, string?> { ["STEMMA_AUTHOR"] = "Theo", ["CLAUDECODE"] = "1" }, "comments", "reply", "c_async", "one", "--author", "Flag").ExitCode.Should().Be(0);
        Stemma(new Dictionary<string, string?> { ["STEMMA_AUTHOR"] = "Theo", ["CLAUDECODE"] = "1" }, "comments", "reply", "c_async", "two").ExitCode.Should().Be(0);
        Stemma(new Dictionary<string, string?> { ["CLAUDECODE"] = "1" }, "comments", "reply", "c_async", "three").ExitCode.Should().Be(0);
        Stemma("comments", "reply", "c_async", "four").ExitCode.Should().Be(0);

        Read("c_async").Thread.Select(r => r.Author).Should().Equal("Flag", "Theo", "Claude", "Aria from git");
    }

    [Fact]
    public void Text_can_come_from_standard_input_for_a_longer_reply()
    {
        Workspace();
        File.WriteAllText(CommentsPath, Comments);
        var psi = SiblingProgram.StartInfo(Path.Combine(AppContext.BaseDirectory, "stemma.dll"));
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.WorkingDirectory = Ws;
        foreach (var a in new[] { "comments", "reply", "c_async", "-", "--author", "Claude" }) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        p.StandardInput.Write("Two things:\n- a queue\n- an outbox\n");
        p.StandardInput.Close();
        p.WaitForExit();

        p.ExitCode.Should().Be(0);
        Read("c_async").Thread.Single().Body.Should().Be("Two things:\n- a queue\n- an outbox");
    }

    // ---------------------------------------------------------------- diff

    [Fact]
    public void On_a_branch_the_change_is_counted_from_where_the_branch_started()
    {
        if (!GitAvailable()) return;
        Workspace();
        File.WriteAllText(CommentsPath, Comments);
        Git("init", "-q", "-b", "main");
        Git("add", "-A");
        Git("commit", "-q", "-m", "shop");
        Git("checkout", "-q", "-b", "feat/queue");

        // A commit on the branch and an edit not yet committed: a pull request is both.
        File.WriteAllText(Path.Combine(Ws, "Architecture", "Architecture.cs"), Model
            .Replace("\"service\", \".NET 8\"", "\"service\", \"Go\"")
            .Replace("var flowSave = new DataFlow(\"flow_save\", \"cnt_api\", \"cnt_db\", \"Orders\", Technology: \"SQL\");",
                     "var cntQueue = new Container(\"cnt_queue\", \"Order Queue\", \"sys_shop\", \"queue\");\n        var flowSave = new DataFlow(\"flow_save\", \"cnt_queue\", \"cnt_db\", \"Orders\", Technology: \"SQL\");")
            .Replace("Model.Of(sysShop, cntApi, cntDb, flowSave)", "Model.Of(sysShop, cntApi, cntDb, cntQueue, flowSave)"));
        Git("commit", "-q", "-am", "queue");
        Stemma("comments", "resolve", "c_async", "Through a queue now.", "--author", "Claude").ExitCode.Should().Be(0);

        var (exit, output, _) = Stemma("diff");

        exit.Should().Be(0);
        output.Should().StartWith("stemma diff: ws since where feat/queue started from main (");
        output.Should().Contain("— 1 added · 2 changed");
        output.Should().Contain("Added (1)\n  Container “Order Queue” (cnt_queue)");
        output.Should().Contain("Container “API” (cnt_api): Technology “.NET 8” → “Go”");
        output.Should().Contain("Data flow Order Queue → Orders DB · Orders (flow_save): Now from “Order Queue” (was “API”)");
        output.Should().Contain("Review comments resolved (1)\n  Data flow “Order Queue → Orders DB · Orders” (flow_save) — Aria: Should saving be asynchronous?");
    }

    [Fact]
    public void Markdown_is_a_pull_request_section_and_json_is_for_an_agent()
    {
        if (!GitAvailable()) return;
        Workspace();
        Git("init", "-q", "-b", "main");
        Git("add", "-A");
        Git("commit", "-q", "-m", "shop");
        File.WriteAllText(Path.Combine(Ws, "Architecture", "Architecture.cs"), Model.Replace("\"Orders DB\"", "\"Order_Store*\""));

        var md = Stemma("diff", "--markdown");
        md.ExitCode.Should().Be(0);
        md.Output.Should().StartWith("### Architecture changes\n\nCompared with the last commit (`");
        md.Output.Should().Contain("**Changed (1)**\n\n- Container “Order\\_Store\\*” (`cnt_db`): Renamed from “Orders DB”");

        var (exit, output, _) = Stemma("diff", "--json");
        exit.Should().Be(0);
        using var json = JsonDocument.Parse(output);
        json.RootElement.GetProperty("base").GetProperty("since").GetString().Should().Be("the last commit");
        json.RootElement.GetProperty("counts").GetProperty("changed").GetInt32().Should().Be(1);
        var change = json.RootElement.GetProperty("elements")[0];
        (change.GetProperty("id").GetString(), change.GetProperty("change").GetString()).Should().Be(("cnt_db", "changed"));
        change.GetProperty("details")[0].GetString().Should().Be("Renamed from “Orders DB”");
    }

    [Fact]
    public void A_base_that_is_not_a_revision_and_a_folder_that_is_not_a_repository_are_said_to_be()
    {
        Workspace();
        var (exit, _, error) = Stemma("diff");
        exit.Should().Be(2);
        error.Should().Contain("not in a Git repository");

        if (!GitAvailable()) return;
        Git("init", "-q", "-b", "main");
        Git("add", "-A");
        Git("commit", "-q", "-m", "shop");
        // Taken as the revision, and refused as one: it never reaches git as an option.
        Stemma("diff", "--base", "--output=/tmp/x").Error.Should().Contain("\"--output=/tmp/x\" is not a revision");
        var bad = Stemma("diff", "--base", "no-such-branch");
        bad.ExitCode.Should().Be(2);
        bad.Error.Should().Contain("There is no commit \"no-such-branch\"");
        Stemma("diff").Output.Should().EndWith("— No changes");
        // A path typed with its separator still names the workspace.
        Stemma("diff", "./").Output.Should().StartWith("stemma diff: ws since the last commit");
    }
}
