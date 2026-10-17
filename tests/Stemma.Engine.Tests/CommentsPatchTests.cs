using System.Text.Json;
using FluentAssertions;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// B-018. comments.stemma.json is changed the way stemma.layout.json is (ADR-0021): each change is
/// made to the file as it is, and everything else in it — order, keys Stemma does not know,
/// escaping, layout, line endings, the final newline — stays byte for byte. Comments are a list, so
/// a change names the comment by its id rather than by a path of keys. Every case compares the
/// whole file with a hand-written edit of it.
/// </summary>
public sealed class CommentsPatchTests
{
    /// <summary>As Stemma wrote it until now: escaped to ASCII, two spaces, LF, no final newline.</summary>
    private const string Written = """
        {
          "version": 1,
          "comments": [
            {
              "id": "cmt_1",
              "targetKind": "element",
              "targetId": "ctx_sales",
              "author": "ada",
              "createdAt": "2026-10-01T09:00:00Z",
              "body": "Should Sales own the basket? \u2014 see ADR-0007",
              "resolved": false,
              "thread": []
            },
            {
              "id": "cmt_2",
              "targetKind": "element",
              "targetId": "mod_checkout",
              "author": "sam",
              "createdAt": "2026-10-02T10:00:00Z",
              "body": "Checkout calls RESERVA synchronously.",
              "resolved": false,
              "thread": [
                {
                  "author": "ada",
                  "createdAt": "2026-10-02T11:00:00Z",
                  "body": "Until the strangler lands."
                }
              ]
            }
          ]
        }
        """;

    /// <summary>By hand: four spaces, raw Polish, a key Stemma does not know, a thread on one line.</summary>
    private const string Hand = """
        {
            "version": 1,
            "reviewedBy": "zespół architektury",
            "comments": [
                {
                    "id": "cmt_a",
                    "targetKind": "element",
                    "targetId": "ctx_fares",
                    "author": "Bartosz",
                    "createdAt": "2026-10-03T08:00:00Z",
                    "body": "Czy taryfy należą do tego kontekstu?",
                    "resolved": false,
                    "labels": ["pytanie"],
                    "thread": [{ "author": "Ada", "createdAt": "2026-10-03T09:00:00Z", "body": "Tak, na razie." }]
                }
            ]
        }

        """;

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static string Apply(string text, params CommentChange[] changes) => CommentsPatch.Apply(text, changes);

    private static readonly JsonElement Basket = Json("""
        {"id":"cmt_3","targetKind":"element","targetId":"mod_basket","author":"bartosz","createdAt":"2026-10-17T12:00:00Z","body":"Rename to Shopping Basket?","resolved":false,"thread":[]}
        """);

    private static readonly JsonElement Reply = Json("""
        {"author":"sam","createdAt":"2026-10-17T12:30:00Z","body":"Yes, with the orders."}
        """);

    // ---------------------------------------------------------------- adding

    [Fact]
    public void A_new_comment_goes_after_the_last_one_laid_out_like_it()
    {
        Apply(Written, new CommentChange.Add(Basket)).Should().Be(Written.Replace("\n  ]\n}", """
            ,
                {
                  "id": "cmt_3",
                  "targetKind": "element",
                  "targetId": "mod_basket",
                  "author": "bartosz",
                  "createdAt": "2026-10-17T12:00:00Z",
                  "body": "Rename to Shopping Basket?",
                  "resolved": false,
                  "thread": []
                }
              ]
            }
            """));
    }

    [Fact]
    public void A_comment_whose_id_is_already_there_changes_nothing()
    {
        // A pack imported twice, or a request sent again after it landed.
        var again = Json(Basket.GetRawText().Replace("cmt_3", "cmt_2"));
        Apply(Written, new CommentChange.Add(again)).Should().Be(Written);
    }

    [Fact]
    public void The_first_comment_opens_an_empty_list_onto_lines()
    {
        const string empty = "{\n  \"version\": 1,\n  \"comments\": []\n}\n";
        Apply(empty, new CommentChange.Add(Basket)).Should().Be("""
            {
              "version": 1,
              "comments": [
                {
                  "id": "cmt_3",
                  "targetKind": "element",
                  "targetId": "mod_basket",
                  "author": "bartosz",
                  "createdAt": "2026-10-17T12:00:00Z",
                  "body": "Rename to Shopping Basket?",
                  "resolved": false,
                  "thread": []
                }
              ]
            }

            """);
    }

    [Fact]
    public void A_file_with_no_list_yet_gains_one()
    {
        Apply("{\n  \"version\": 1\n}\n", new CommentChange.Add(Basket)).Should().Be("""
            {
              "version": 1,
              "comments": [
                {
                  "id": "cmt_3",
                  "targetKind": "element",
                  "targetId": "mod_basket",
                  "author": "bartosz",
                  "createdAt": "2026-10-17T12:00:00Z",
                  "body": "Rename to Shopping Basket?",
                  "resolved": false,
                  "thread": []
                }
              ]
            }

            """);
    }

    [Fact]
    public void A_handwritten_file_keeps_its_indentation_its_characters_and_its_keys()
    {
        var comment = Json("""
            {"id":"cmt_b","targetKind":"element","targetId":"mod_quote","author":"Ewa","createdAt":"2026-10-17T12:00:00Z","body":"Wycena <T> też tutaj?","resolved":false,"thread":[]}
            """);

        Apply(Hand, new CommentChange.Add(comment)).Should().Be(Hand.Replace("\n    ]\n}", """
            ,
                    {
                        "id": "cmt_b",
                        "targetKind": "element",
                        "targetId": "mod_quote",
                        "author": "Ewa",
                        "createdAt": "2026-10-17T12:00:00Z",
                        "body": "Wycena <T> też tutaj?",
                        "resolved": false,
                        "thread": []
                    }
                ]
            }
            """));
    }

    [Fact]
    public void New_text_is_escaped_the_way_the_file_is()
    {
        // A file that escapes keeps escaping, so the new comment matches the ones beside it…
        var polish = Json(Basket.GetRawText().Replace("Rename to Shopping Basket?", "Należy do Sprzedaży — tak?"));
        Apply(Written, new CommentChange.Add(polish))
            .Should().Contain("\"body\": \"Nale\\u017Cy do Sprzeda\\u017Cy \\u2014 tak?\"");

        // …and one that has never escaped anything is not taught to.
        Apply("{\n  \"version\": 1,\n  \"comments\": []\n}\n", new CommentChange.Add(polish))
            .Should().Contain("\"body\": \"Należy do Sprzedaży — tak?\"");
    }

    [Fact]
    public void Line_endings_stay_as_the_file_has_them()
    {
        var crlf = Written.Replace("\n", "\r\n");
        var patched = Apply(crlf, new CommentChange.Add(Basket));

        patched.Replace("\r\n", "").Should().NotContain("\n");
        patched.Should().Be(Apply(Written, new CommentChange.Add(Basket)).Replace("\n", "\r\n"));
    }

    // ---------------------------------------------------------------- replying

    [Fact]
    public void A_reply_opens_an_empty_thread_onto_lines()
    {
        Apply(Written, new CommentChange.AddReply("cmt_1", Reply)).Should().Be(Written.Replace("""
                  "body": "Should Sales own the basket? \u2014 see ADR-0007",
                  "resolved": false,
                  "thread": []
            """, """
                  "body": "Should Sales own the basket? \u2014 see ADR-0007",
                  "resolved": false,
                  "thread": [
                    {
                      "author": "sam",
                      "createdAt": "2026-10-17T12:30:00Z",
                      "body": "Yes, with the orders."
                    }
                  ]
            """));
    }

    [Fact]
    public void A_reply_goes_after_the_last_one()
    {
        Apply(Written, new CommentChange.AddReply("cmt_2", Reply)).Should().Be(Written.Replace("""
                      "body": "Until the strangler lands."
                    }
            """, """
                      "body": "Until the strangler lands."
                    },
                    {
                      "author": "sam",
                      "createdAt": "2026-10-17T12:30:00Z",
                      "body": "Yes, with the orders."
                    }
            """));
    }

    [Fact]
    public void A_reply_to_a_thread_on_one_line_stays_on_it()
    {
        var reply = Json("""{"author":"Ewa","createdAt":"2026-10-17T12:30:00Z","body":"Dzięki."}""");

        Apply(Hand, new CommentChange.AddReply("cmt_a", reply)).Should().Be(Hand.Replace(
            "\"body\": \"Tak, na razie.\" }]",
            "\"body\": \"Tak, na razie.\" }, {\"author\":\"Ewa\",\"createdAt\":\"2026-10-17T12:30:00Z\",\"body\":\"Dzięki.\"}]"));
    }

    [Fact]
    public void A_comment_with_no_thread_gains_one()
    {
        var bare = Written.Replace(",\n      \"thread\": []", "");

        Apply(bare, new CommentChange.AddReply("cmt_1", Reply)).Should().Be(bare.Replace("""
                  "resolved": false
                },
            """, """
                  "resolved": false,
                  "thread": [
                    {
                      "author": "sam",
                      "createdAt": "2026-10-17T12:30:00Z",
                      "body": "Yes, with the orders."
                    }
                  ]
                },
            """));
    }

    [Fact]
    public void A_reply_that_is_already_there_changes_nothing()
    {
        var same = Json("""{"author":"ada","createdAt":"2026-10-02T11:00:00Z","body":"Until the strangler lands."}""");
        Apply(Written, new CommentChange.AddReply("cmt_2", same)).Should().Be(Written);
    }

    [Fact]
    public void A_reply_to_a_comment_that_is_gone_is_refused()
    {
        var refused = () => Apply(Written, new CommentChange.AddReply("cmt_gone", Reply));
        refused.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("NoSuchComment");
    }

    // ---------------------------------------------------------------- resolving

    [Fact]
    public void Resolving_changes_that_one_value()
    {
        Apply(Written, new CommentChange.SetResolved("cmt_2", true)).Should().Be(Written.Replace(
            "\"Checkout calls RESERVA synchronously.\",\n      \"resolved\": false",
            "\"Checkout calls RESERVA synchronously.\",\n      \"resolved\": true"));
    }

    [Fact]
    public void Resolving_what_is_resolved_changes_nothing()
    {
        Apply(Written, new CommentChange.SetResolved("cmt_1", false)).Should().Be(Written);
    }

    [Fact]
    public void Resolving_a_handwritten_comment_leaves_its_other_keys_alone()
    {
        Apply(Hand, new CommentChange.SetResolved("cmt_a", true))
            .Should().Be(Hand.Replace("\"resolved\": false", "\"resolved\": true"));
    }

    [Fact]
    public void Resolving_a_comment_that_is_gone_is_refused()
    {
        var refused = () => Apply(Written, new CommentChange.SetResolved("cmt_gone", true));
        refused.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("NoSuchComment");
    }

    // ---------------------------------------------------------------- removing

    [Fact]
    public void Removing_a_comment_takes_its_lines_and_one_comma()
    {
        var first = Written.IndexOf("    {\n      \"id\": \"cmt_1\"", StringComparison.Ordinal);
        var second = Written.IndexOf("    {\n      \"id\": \"cmt_2\"", StringComparison.Ordinal);

        Apply(Written, new CommentChange.Remove("cmt_1")).Should().Be(Written.Remove(first, second - first));
    }

    [Fact]
    public void Removing_the_last_comment_takes_the_comma_before_it()
    {
        var end = Written.IndexOf(",\n    {\n      \"id\": \"cmt_2\"", StringComparison.Ordinal);
        var close = Written.LastIndexOf("\n  ]", StringComparison.Ordinal);

        Apply(Written, new CommentChange.Remove("cmt_2")).Should().Be(Written.Remove(end, close - end));
    }

    [Fact]
    public void Removing_the_only_comment_leaves_an_empty_list()
    {
        Apply(Hand, new CommentChange.Remove("cmt_a")).Should().Be("""
            {
                "version": 1,
                "reviewedBy": "zespół architektury",
                "comments": []
            }

            """);
    }

    [Fact]
    public void Removing_a_comment_that_is_gone_changes_nothing()
    {
        Apply(Written, new CommentChange.Remove("cmt_gone")).Should().Be(Written);
    }

    // ---------------------------------------------------------------- refusing

    [Theory]
    [InlineData("{\n<<<<<<< HEAD\n  \"version\": 1,\n=======\n  \"version\": 2,\n>>>>>>> theirs\n  \"comments\": []\n}\n")]
    [InlineData("")]
    [InlineData("[]")]
    [InlineData("{ \"version\": 1, \"comments\": {} }")]
    public void A_file_that_cannot_be_read_is_refused_not_replaced(string text)
    {
        var refused = () => Apply(text, new CommentChange.Add(Basket));
        var e = refused.Should().Throw<SidecarPatchRefusedException>().Which;
        e.Reason.Should().Be("UnreadableSidecar");
        e.Message.Should().Contain("comments.stemma.json");
    }

    [Fact]
    public void A_file_that_cannot_be_read_says_where_as_an_editor_counts_lines()
    {
        // Whoever reads this is about to open the file and fix a merge: the line is what helps.
        var refused = () => Apply("{\n<<<<<<< HEAD\n  \"version\": 1\n}\n", new CommentChange.Add(Basket));
        refused.Should().Throw<SidecarPatchRefusedException>().Which.Message
            .Should().StartWith("comments.stemma.json cannot be read at line 2: ")
            .And.NotContain("LineNumber").And.NotContain("..");
    }

    [Theory]
    [InlineData("""{"targetId":"mod_basket","body":"no id"}""")]
    [InlineData("""{"id":"","targetId":"mod_basket","body":"empty id"}""")]
    [InlineData("""{"id":"cmt_9","targetId":"mod_basket"}""")]
    [InlineData("""["not","an","object"]""")]
    public void A_comment_without_an_id_a_target_and_a_body_is_refused(string json)
    {
        var refused = () => Apply(Written, new CommentChange.Add(Json(json)));
        refused.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("NotAComment");
    }

    [Fact]
    public void Several_changes_apply_in_order()
    {
        var patched = Apply(Written,
            new CommentChange.Add(Basket),
            new CommentChange.AddReply("cmt_3", Reply),
            new CommentChange.SetResolved("cmt_3", true),
            new CommentChange.Remove("cmt_1"));

        using var doc = JsonDocument.Parse(patched);
        var comments = doc.RootElement.GetProperty("comments").EnumerateArray().ToList();
        comments.Select(c => c.GetProperty("id").GetString()).Should().Equal("cmt_2", "cmt_3");
        comments[1].GetProperty("resolved").GetBoolean().Should().BeTrue();
        comments[1].GetProperty("thread").GetArrayLength().Should().Be(1);
    }
}
