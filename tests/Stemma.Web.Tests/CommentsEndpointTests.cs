using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Stemma.Web;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The canvas reads comments.stemma.json with GET and changes it with PATCH: a list of changes, each
/// naming a comment by its id, applied to the file as it is on disk (B-018). The whole-file PUT is
/// gone — it wrote the panel's copy over the file, and read a file it could not parse as empty.
/// </summary>
public sealed class CommentsEndpointTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"stemma-commentsapi-{Guid.NewGuid():N}");
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    // Written by hand: raw Polish, a key Stemma does not know, a final newline.
    private const string Comments = """
        {
          "version": 1,
          "comments": [
            {
              "id": "cmt_1",
              "targetKind": "element",
              "targetId": "ctx_a",
              "author": "Bartosz",
              "createdAt": "2026-10-01T09:00:00Z",
              "body": "Czy ten kontekst jest potrzebny?",
              "resolved": false,
              "labels": ["pytanie"],
              "thread": []
            }
          ]
        }

        """;

    static CommentsEndpointTests() => Environment.SetEnvironmentVariable("STEMMA_LOG_FILE", "off");

    private string File_ => Path.Combine(_root, "comments.stemma.json");

    public async Task InitializeAsync()
    {
        _app = StemmaWebHost.Build(["--urls", StemmaWebHost.DynamicLoopbackUrl, "--log-level", "none"]);
        await _app.StartAsync();
        _http = new HttpClient { BaseAddress = new Uri(StemmaWebHost.BoundUrl(_app)), Timeout = TimeSpan.FromMinutes(2) };
        var created = await _http.PostAsJsonAsync("/api/workspace/init", new { rootPath = _root, name = "Comments" });
        created.StatusCode.Should().Be(HttpStatusCode.OK);
        await File.WriteAllTextAsync(File_, Comments);
    }

    public async Task DisposeAsync()
    {
        _http.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private Task<HttpResponseMessage> PatchAsync(object body) =>
        _http.PatchAsync("/api/workspace/comments", JsonContent.Create(body));

    [Fact]
    public async Task Get_returns_the_file_as_it_is()
    {
        (await _http.GetStringAsync("/api/workspace/comments")).Should().Be(Comments);
    }

    [Fact]
    public async Task Get_without_a_file_is_an_empty_list()
    {
        File.Delete(File_);
        var read = await _http.GetFromJsonAsync<JsonElement>("/api/workspace/comments");
        read.GetProperty("comments").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Patch_changes_the_comments_it_names_and_answers_with_the_file()
    {
        var response = await PatchAsync(new
        {
            changes = new object[]
            {
                new { op = "reply", id = "cmt_1", reply = new { author = "Ada", createdAt = "2026-10-17T12:30:00Z", body = "Tak." } },
                new { op = "resolve", id = "cmt_1", resolved = true },
            },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var expected = Comments
            .Replace("\"resolved\": false", "\"resolved\": true")
            .Replace("\"thread\": []", "\"thread\": [\n        {\n          \"author\": \"Ada\",\n          \"createdAt\": \"2026-10-17T12:30:00Z\",\n          \"body\": \"Tak.\"\n        }\n      ]");
        (await File.ReadAllTextAsync(File_)).Should().Be(expected);
        (await response.Content.ReadAsStringAsync()).Should().Be(expected, "the panel shows what the file now says");
    }

    [Fact]
    public async Task A_comment_added_keeps_the_others_as_they_were()
    {
        var response = await PatchAsync(new
        {
            changes = new[]
            {
                new
                {
                    op = "add",
                    comment = new { id = "cmt_2", targetKind = "element", targetId = "ctx_a", author = "Ada", createdAt = "2026-10-17T12:00:00Z", body = "Zostawmy go.", resolved = false, thread = Array.Empty<object>() },
                },
            },
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var text = await File.ReadAllTextAsync(File_);
        text.Should().StartWith(Comments[..Comments.IndexOf("\n  ]", StringComparison.Ordinal)]);
        text.Should().Contain("\"body\": \"Zostawmy go.\"");
    }

    [Fact]
    public async Task Comments_that_cannot_be_read_are_refused_by_both_and_left_alone()
    {
        const string conflicted = "{\n<<<<<<< HEAD\n  \"version\": 1,\n=======\n  \"version\": 2,\n>>>>>>> theirs\n  \"comments\": []\n}\n";
        await File.WriteAllTextAsync(File_, conflicted);

        var read = await _http.GetAsync("/api/workspace/comments");
        read.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await read.Content.ReadAsStringAsync()).Should().Contain("UnreadableSidecar");

        var write = await PatchAsync(new { changes = new[] { new { op = "resolve", id = "cmt_1", resolved = true } } });
        write.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await File.ReadAllTextAsync(File_)).Should().Be(conflicted);
    }

    [Fact]
    public async Task A_reply_to_a_comment_someone_removed_is_refused()
    {
        var response = await PatchAsync(new
        {
            changes = new[] { new { op = "reply", id = "cmt_gone", reply = new { author = "Ada", createdAt = "2026-10-17T12:30:00Z", body = "Tak." } } },
        });

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync()).Should().Contain("NoSuchComment");
        (await File.ReadAllTextAsync(File_)).Should().Be(Comments);
    }

    [Theory]
    [InlineData("""{"changes":[{"op":"rename","id":"cmt_1"}]}""")]
    [InlineData("""{"changes":[{"op":"resolve"}]}""")]
    [InlineData("""{"changes":[{"op":"resolve","id":"cmt_1"}]}""")]
    [InlineData("""{"changes":[{"op":"add"}]}""")]
    public async Task A_change_that_does_not_say_what_to_do_is_a_bad_request(string body)
    {
        var response = await _http.PatchAsync("/api/workspace/comments",
            new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await File.ReadAllTextAsync(File_)).Should().Be(Comments);
    }

    [Fact]
    public async Task The_whole_file_can_no_longer_be_put()
    {
        var put = await _http.PutAsJsonAsync("/api/workspace/comments", new { version = 1, comments = Array.Empty<object>() });
        put.StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await File.ReadAllTextAsync(File_)).Should().Be(Comments);
    }
}
