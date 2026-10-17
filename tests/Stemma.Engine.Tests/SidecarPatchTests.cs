using System.Text.Json;
using FluentAssertions;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The sidecar is written as changes to its text, the way an operation edits Architecture.cs: the
/// span of the value that changed is replaced, inserted or removed, and every other byte — order,
/// unknown keys, escaping, number formats, compact arrays, line endings — stays where it was
/// (ADR-0021, B-014). Each case compares the whole file with the original after exactly the edits
/// the change is allowed to make.
/// </summary>
public sealed class SidecarPatchTests
{
    /// <summary>The way Stemma has written it: escaped to ASCII, two spaces, LF, a final newline.</summary>
    private const string Written = """
        {
          "$schema": "https://example.test/stemma.layout.schema.json",
          "version": 1,
          "views": {
            "custom:view_shape": {
              "layout": {
                "kind": "grid",
                "gap": [
                  90,
                  70
                ]
              },
              "nodes": {
                "cnt_web": {
                  "x": 10.50,
                  "y": 20
                },
                "cnt_cli": {
                  "x": 300,
                  "y": 20
                }
              },
              "edges": {}
            }
          },
          "notes": {
            "cnt_web": "Serves the canvas \u2014 and nothing else."
          },
          "palettes": {
            "ink": "#222"
          }
        }

        """;

    /// <summary>The way a person wrote it: tabs, CRLF, compact arrays, raw non-ASCII, no final newline.</summary>
    private static readonly string Handwritten = string.Join("\r\n",
        "{",
        "\t\"version\": 1,",
        "\t\"views\": {",
        "\t\t\"moduleMap\": { \"nodes\": { \"mod_a\": { \"x\": 1, \"y\": 2 } }, \"gap\": [90, 70] }",
        "\t},",
        "\t\"notes\": {",
        "\t\t\"mod_a\": \"Owns the gate — keep it small.\"",
        "\t}",
        "}");

    private static SidecarChange Set(string json, params string[] path) =>
        new(path, JsonDocument.Parse(json).RootElement.Clone());

    private static SidecarChange Remove(params string[] path) => new(path, null);

    private static string Expect(string before, params (string From, string To)[] edits)
    {
        var after = before;
        foreach (var (from, to) in edits)
        {
            after.Split(from).Length.Should().Be(2, $"the edit target must be unique: {from}");
            after = after.Replace(from, to);
        }
        return after;
    }

    [Fact]
    public void Changing_a_number_changes_that_number()
    {
        SidecarPatch.Apply(Written, [Set("12", "views", "custom:view_shape", "nodes", "cnt_web", "x")])
            .Should().Be(Expect(Written, ("\"x\": 10.50", "\"x\": 12")));
    }

    [Fact]
    public void Setting_what_is_already_there_changes_nothing()
    {
        // 10.50 and 10.5 are the same number: the file keeps the author's spelling of it.
        SidecarPatch.Apply(Written, [Set("10.5", "views", "custom:view_shape", "nodes", "cnt_web", "x")])
            .Should().Be(Written);
        SidecarPatch.Apply(Written, [Set("""{ "x": 300, "y": 20 }""", "views", "custom:view_shape", "nodes", "cnt_cli")])
            .Should().Be(Written);
    }

    [Fact]
    public void A_new_entry_goes_after_the_last_one_laid_out_like_it()
    {
        SidecarPatch.Apply(Written, [Set("""{"x":600,"y":20}""", "views", "custom:view_shape", "nodes", "cnt_desktop")])
            .Should().Be(Expect(Written, (
                """
                        "cnt_cli": {
                          "x": 300,
                          "y": 20
                        }
                """,
                """
                        "cnt_cli": {
                          "x": 300,
                          "y": 20
                        },
                        "cnt_desktop": {
                          "x": 600,
                          "y": 20
                        }
                """)));
    }

    [Fact]
    public void A_new_entry_in_an_empty_object_opens_it_onto_lines()
    {
        SidecarPatch.Apply(Written, [Set("""{"handles":{"source":"right"}}""", "views", "custom:view_shape", "edges", "flow_a")])
            .Should().Be(Expect(Written, (
                """
                      "edges": {}
                """,
                """
                      "edges": {
                        "flow_a": {
                          "handles": {
                            "source": "right"
                          }
                        }
                      }
                """)));
    }

    [Fact]
    public void A_path_that_does_not_exist_yet_is_created_where_it_starts()
    {
        SidecarPatch.Apply(Written, [Set("""{"x":1,"y":2}""", "views", "custom:view_new", "nodes", "mod_a")])
            .Should().Be(Expect(Written, (
                """
                      "edges": {}
                    }
                  },
                """,
                """
                      "edges": {}
                    },
                    "custom:view_new": {
                      "nodes": {
                        "mod_a": {
                          "x": 1,
                          "y": 2
                        }
                      }
                    }
                  },
                """)));
    }

    [Fact]
    public void Removing_an_entry_takes_its_lines_and_one_comma()
    {
        SidecarPatch.Apply(Written, [Remove("views", "custom:view_shape", "nodes", "cnt_web")])
            .Should().Be(Expect(Written, (
                """
                        "cnt_web": {
                          "x": 10.50,
                          "y": 20
                        },

                """, "")));

        SidecarPatch.Apply(Written, [Remove("views", "custom:view_shape", "nodes", "cnt_cli")])
            .Should().Be(Expect(Written, (
                """
                          "y": 20
                        },
                        "cnt_cli": {
                          "x": 300,
                          "y": 20
                        }
                """,
                """
                          "y": 20
                        }
                """)));
    }

    [Fact]
    public void Removing_the_only_entry_leaves_an_empty_object()
    {
        SidecarPatch.Apply(Written, [Remove("notes", "cnt_web")])
            .Should().Be(Expect(Written, (
                """
                  "notes": {
                    "cnt_web": "Serves the canvas \u2014 and nothing else."
                  },
                """,
                """
                  "notes": {},
                """)));
    }

    [Fact]
    public void Removing_what_is_not_there_changes_nothing()
    {
        SidecarPatch.Apply(Written, [Remove("notes", "mod_zzz"), Remove("views", "custom:view_gone", "nodes", "a")])
            .Should().Be(Written);
    }

    [Fact]
    public void New_text_is_escaped_the_way_the_file_is()
    {
        // An ASCII file gets its dash escaped like the one already in it…
        SidecarPatch.Apply(Written, [Set("\"Drawn — not modelled.\"", "notes", "cnt_cli")])
            .Should().Contain("\"cnt_cli\": \"Drawn \\u2014 not modelled.\"");
        // …and a file that holds raw characters gets a raw one.
        SidecarPatch.Apply(Handwritten, [Set("\"Drawn — not modelled.\"", "notes", "mod_b")])
            .Should().Contain("\"mod_b\": \"Drawn — not modelled.\"");
    }

    [Fact]
    public void A_handwritten_file_keeps_its_tabs_line_endings_and_compact_lines()
    {
        SidecarPatch.Apply(Handwritten, [Set("5", "views", "moduleMap", "nodes", "mod_a", "y")])
            .Should().Be(Expect(Handwritten, ("\"y\": 2", "\"y\": 5")));

        // A new entry in an object written on one line stays on that line.
        SidecarPatch.Apply(Handwritten, [Set("""{"x":3,"y":4}""", "views", "moduleMap", "nodes", "mod_b")])
            .Should().Be(Expect(Handwritten, (
                "\"mod_a\": { \"x\": 1, \"y\": 2 } }",
                "\"mod_a\": { \"x\": 1, \"y\": 2 }, \"mod_b\": {\"x\":3,\"y\":4} }")));

        // A new entry in an object laid out on lines takes its tabs and its CRLF.
        SidecarPatch.Apply(Handwritten, [Set("\"Second.\"", "notes", "mod_b")])
            .Should().Be(Expect(Handwritten, (
                "\t\t\"mod_a\": \"Owns the gate — keep it small.\"\r\n",
                "\t\t\"mod_a\": \"Owns the gate — keep it small.\",\r\n\t\t\"mod_b\": \"Second.\"\r\n")));
    }

    [Fact]
    public void Several_changes_apply_in_order()
    {
        SidecarPatch.Apply(Written, [
            Set("12", "views", "custom:view_shape", "nodes", "cnt_web", "x"),
            Remove("palettes", "ink"),
            Set("2", "version"),
        ]).Should().Be(Expect(Written,
            ("\"x\": 10.50", "\"x\": 12"),
            ("\"version\": 1", "\"version\": 2"),
            ("""
              "palettes": {
                "ink": "#222"
              }
            """,
            """
              "palettes": {}
            """)));
    }

    [Theory]
    [InlineData("{ \"views\": { <<<<<<< HEAD")]
    [InlineData("[1, 2]")]
    [InlineData("")]
    public void A_file_that_cannot_be_read_is_refused_not_replaced(string text)
    {
        var refuse = () => SidecarPatch.Apply(text, [Set("1", "version")]);
        refuse.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("UnreadableSidecar");
    }

    [Fact]
    public void A_path_through_a_value_that_is_not_an_object_is_refused()
    {
        var refuse = () => SidecarPatch.Apply(Written, [Set("1", "notes", "cnt_web", "x")]);
        refuse.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("NotAnObject");
    }
}
