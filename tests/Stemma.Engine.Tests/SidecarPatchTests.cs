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
    public void An_emoji_is_written_raw_and_does_not_turn_the_file_into_an_escaping_one()
    {
        // System.Text.Json escapes an emoji even when told not to escape, so "Ship it 🚀" was written as
        // `🚀`, and from then on the file counted as one that escapes: Polish letters,
        // apostrophes, <, & and + were all escaped in every later edit (ADR-0021 says raw).
        const string ascii = "{\n  \"version\": 1,\n  \"notes\": {}\n}\n";
        var once = SidecarPatch.Apply(ascii, [Set("\"Ship it 🚀\"", "notes", "a")]);
        once.Should().Be("{\n  \"version\": 1,\n  \"notes\": {\n    \"a\": \"Ship it 🚀\"\n  }\n}\n");
        SidecarPatch.Apply(once, [Set("\"Zażółć gęślą jaźń <b> & 'x' + y\"", "notes", "b")])
            .Should().Contain("\"b\": \"Zażółć gęślą jaźń <b> & 'x' + y\"");

        // A file that an earlier version left holding an escaped emoji is not an escaping file either.
        const string pair = "{\n  \"notes\": {\n    \"a\": \"Ship it \\ud83d\\ude80\"\n  }\n}\n";
        SidecarPatch.Apply(pair, [Set("\"Zażółć <b>\"", "notes", "b")]).Should().Contain("\"b\": \"Zażółć <b>\"");
    }

    [Fact]
    public void Written_raw_new_text_still_escapes_what_JSON_requires()
    {
        const string ascii = "{\n  \"notes\": {}\n}\n";
        SidecarPatch.Apply(ascii, [Set("\"a \\\"quoted\\\" \\\\ path\\u0001\\n\"", "notes", "a\"b")])
            .Should().Contain("\"a\\\"b\": \"a \\\"quoted\\\" \\\\ path\\u0001\\n\"");
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

    [Theory]
    [InlineData("{\n  \"version\": 1,\n<<<<<<< HEAD\n  \"a\": 1\n=======\n  \"a\": 2\n>>>>>>> theirs\n}\n",
        "stemma.layout.json has merge conflict markers at line 3; resolve the conflict and save it.")]
    [InlineData("{\n  \"a\": 1,\n  \"b\": 2,\n}\n",
        "stemma.layout.json has a comma after its last entry at line 3; JSON does not allow one there.")]
    [InlineData("{\n  \"a\": [1, 2,]\n}\n",
        "stemma.layout.json has a comma after its last entry at line 2; JSON does not allow one there.")]
    [InlineData("{\n  // positions\n  \"a\": 1\n}\n",
        "stemma.layout.json has a comment at line 2; JSON does not allow comments.")]
    [InlineData("{\n  \"a\": 1 /* x */\n}\n",
        "stemma.layout.json has a comment at line 2; JSON does not allow comments.")]
    [InlineData("{\n  \"a\": {\n    \"b\": 1\n",
        "stemma.layout.json ends before everything it opens is closed.")]
    [InlineData("",
        "stemma.layout.json is empty.")]
    [InlineData("{\n  \"a\": 1\n  \"b\": 2\n}\n",
        "stemma.layout.json has '\"' at line 3, column 3, where JSON does not allow it.")]
    [InlineData("{\n  \"a\": [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]\n}\n",
        "stemma.layout.json nests deeper than the 64 levels it is read to, at line 2.")]
    [InlineData("{\n  \"a\": ​1\n}\n",
        "stemma.layout.json has an invisible character, U+200B, at line 2, column 8, where JSON does not allow it.")]
    public void A_file_that_cannot_be_read_is_described_in_plain_words(string text, string message)
    {
        // The parser's own words reached the person fixing the file: "not supported in this mode.
        // Change the reader options." for a trailing comma, "'/' is invalid after a value" for a comment.
        var refuse = () => SidecarPatch.Apply(text, []);
        refuse.Should().Throw<SidecarPatchRefusedException>().Which.Message.Should().Be(message);
    }

    [Fact]
    public void A_change_holding_half_an_emoji_is_refused_as_a_bad_change()
    {
        // A note cut off in the middle of an emoji: reading the value threw, which is not a refusal,
        // so the endpoint answered 500, and since the canvas sends a failed change again with every
        // save, every later save failed too.
        var halves = new[]
        {
            Set("\"Ship it \\ud83d\"", "notes", "cnt_cli"),
            Set("{\"a\\udc00\": 1}", "palettes", "custom"),
            Set("[\"fine\", \"\\ud83d\"]", "palettes", "list"),
            new SidecarChange(["notes", "cnt\ud83d"], JsonDocument.Parse("\"x\"").RootElement.Clone()),
        };
        foreach (var change in halves)
        {
            var refuse = () => SidecarPatch.Apply(Written, [Set("2", "version"), change]);
            var refused = refuse.Should().Throw<SidecarPatchRefusedException>().Which;
            refused.Reason.Should().Be("InvalidText");
            refused.Message.Should().Contain("not valid Unicode");
        }

        // A whole emoji, escaped as a pair, is text like any other.
        SidecarPatch.Apply(Written, [Set("\"Ship it \\ud83d\\ude80\"", "notes", "cnt_cli")]).Should().Contain("cnt_cli");
    }

    [Fact]
    public void A_file_holding_half_an_emoji_is_refused_with_its_line_when_it_is_read()
    {
        // What GET does: it threw where PATCH, behind its own catch, refused.
        const string text = "{\n  \"notes\": {\n    \"a\": \"cut \\ud83d\"\n  }\n}\n";
        var read = () => SidecarPatch.Apply(text, []);
        var refused = read.Should().Throw<SidecarPatchRefusedException>().Which;
        refused.Reason.Should().Be("UnreadableSidecar");
        refused.Message.Should().Contain("line 3").And.Contain("not valid Unicode");
    }

    [Fact]
    public void A_file_with_a_key_twice_in_one_object_is_refused_naming_the_key()
    {
        // An edit changed the first copy, the browser's JSON.parse kept the last, so the edit looked
        // lost; and a removal left the second copy standing.
        const string text = "{\n  \"version\": 1,\n  \"notes\": {\n    \"a\": \"first\",\n    \"a\": \"second\"\n  }\n}\n";

        foreach (var change in new[] { Set("\"edited\"", "notes", "a"), Remove("notes", "a") })
        {
            var refuse = () => SidecarPatch.Apply(text, [change]);
            var refused = refuse.Should().Throw<SidecarPatchRefusedException>().Which;
            refused.Reason.Should().Be("UnreadableSidecar");
            refused.Message.Should().Contain("\"a\"").And.Contain("lines 4 and 5");
        }

        var oneLine = () => SidecarPatch.Apply("{ \"notes\": { \"a\": 1, \"a\": 2 } }", []);
        oneLine.Should().Throw<SidecarPatchRefusedException>().Which.Message.Should().Contain("twice in one object, on line 1;");
    }

    [Fact]
    public void Adding_and_then_removing_a_key_in_one_batch_leaves_the_file_as_it_was()
    {
        // The objects made to hold the key stayed behind: `"a": {}` in a file no one meant to change.
        SidecarPatch.Apply(Written, [Set("1", "a", "b"), Remove("a", "b")]).Should().Be(Written);
        SidecarPatch.Apply(Written, [
            Set("""{"x":1,"y":2}""", "views", "custom:view_new", "nodes", "mod_a"),
            Remove("views", "custom:view_new", "nodes", "mod_a"),
        ]).Should().Be(Written);

        // An object set on purpose is the change's, and stays.
        SidecarPatch.Apply(Written, [Set("{}", "a"), Set("1", "a", "b"), Remove("a", "b")])
            .Should().Be(Expect(Written, ("  \"palettes\": {\n    \"ink\": \"#222\"\n  }\n", "  \"palettes\": {\n    \"ink\": \"#222\"\n  },\n  \"a\": {}\n")));
    }

    [Fact]
    public void A_path_deeper_than_the_file_can_hold_is_refused()
    {
        // The file is read to 64 levels. A longer path threw where it was nested, which answered 500.
        var deep = Enumerable.Repeat("k", 70).ToArray();
        var refuse = () => SidecarPatch.Apply(Written, [Set("1", deep)]);
        refuse.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("TooDeep");
        var deepValue = () => SidecarPatch.Apply(Written, [Set(string.Concat(Enumerable.Repeat("[", 60)) + string.Concat(Enumerable.Repeat("]", 60)), "a", "b", "c", "d", "e")]);
        deepValue.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("TooDeep");

        // As deep as it can hold is written, and reads back.
        var written = SidecarPatch.Apply(Written, [Set("1", Enumerable.Repeat("k", 64).ToArray())]);
        var reread = () => SidecarPatch.Apply(written, []);
        reread.Should().NotThrow();
    }

    [Fact]
    public void A_null_on_the_way_to_a_key_is_taken_as_nothing_there()
    {
        // `"views": null`, as a hand edit can leave it, refused every position saved into a view.
        const string text = "{\n  \"version\": 1,\n  \"views\": null\n}\n";

        SidecarPatch.Apply(text, [Set("""{"x":1}""", "views", "m", "nodes", "a")]).Should().Be("""
            {
              "version": 1,
              "views": {
                "m": {
                  "nodes": {
                    "a": {
                      "x": 1
                    }
                  }
                }
              }
            }

            """);
        SidecarPatch.Apply(text, [Set("1", "views", "m"), Remove("views", "m")]).Should().Be(text);
    }

    [Fact]
    public void A_path_through_a_value_that_is_not_an_object_is_refused()
    {
        var refuse = () => SidecarPatch.Apply(Written, [Set("1", "notes", "cnt_web", "x")]);
        refuse.Should().Throw<SidecarPatchRefusedException>().Which.Reason.Should().Be("NotAnObject");
    }

    // ---- books (F-013, ADR-0022) --------------------------------------------------------------
    //
    // Books are the part of the sidecar that is mostly prose, and the part most likely to be written
    // by hand beside text Stemma writes. The promise is F-013's AC2: one page's narrative is one
    // value of the diff, a reorder is the book's `order` and nothing else, and every other byte stays.

    /// <summary>The least a book can be: a name and one page, with no `order`.</summary>
    private const string MinimalBook = """
        {
          "version": 1,
          "books": {
            "book_a": {
              "name": "A walk",
              "pages": {
                "p1": {
                  "title": "The whole",
                  "view": "moduleMap",
                  "narrative": "Start wide."
                }
              }
            }
          }
        }

        """;

    /// <summary>Books as the canvas writes them, beside the views they walk through: two spaces, LF, a final newline.</summary>
    private const string RealisticBooks = """
        {
          "$schema": "https://raw.githubusercontent.com/batas2/Stemma/main/schema/stemma.layout.schema.json",
          "version": 1,
          "views": {
            "moduleMap": {
              "nodes": {
                "mod_gate": {
                  "x": 40,
                  "y": 120
                },
                "mod_payment": {
                  "x": 360,
                  "y": 120
                }
              }
            },
            "custom:view_buy": {
              "layout": {
                "kind": "row",
                "ids": [
                  "mod_gate",
                  "mod_payment",
                  "ext_psp"
                ],
                "gap": 80
              },
              "edges": {}
            }
          },
          "nodeStyles": {
            "ext_psp": {
              "fillColor": "#f5f5f4",
              "borderStyle": "dashed"
            }
          },
          "books": {
            "book_onboarding": {
              "name": "Your first week",
              "pages": {
                "start": {
                  "title": "Start here",
                  "view": "dependencyGraph"
                }
              }
            },
            "book_ticket_sold": {
              "name": "How a Ticket Is Sold",
              "audience": "engineering",
              "order": [
                "context",
                "path",
                "money"
              ],
              "pages": {
                "context": {
                  "title": "Where the sale sits",
                  "view": "moduleMap",
                  "narrative": "Everything a buyer touches, and the one module that takes the money.",
                  "frame": "view"
                },
                "path": {
                  "title": "The path a purchase takes",
                  "view": "view_buy",
                  "narrative": "Follow the arrows from the gate to the provider."
                },
                "money": {
                  "title": "Where the money moves",
                  "view": "view_buy",
                  "narrative": "Payment Orchestration is the only module allowed to call the provider.",
                  "focus": [
                    "mod_payment",
                    "ext_psp"
                  ],
                  "frame": "focus",
                  "others": "dim"
                }
              }
            }
          }
        }

        """;

    /// <summary>
    /// A book a person wrote: tabs, CRLF, no final newline; keys in their own order; the order as a
    /// compact one-line list; one page on one line; a key Stemma does not know inside a page and
    /// another inside the book; numbers spelled oddly; an escaped é and paragraph breaks in prose.
    /// No raw non-ASCII anywhere, so the file escapes and new text must too.
    /// </summary>
    private static readonly string HandwrittenBooks = string.Join("\r\n",
        "{",
        "\t\"version\": 1,",
        "\t\"views\": { \"moduleMap\": { \"nodes\": { \"mod_payment\": { \"x\": 1.0, \"y\": -2e1 } } } },",
        "\t\"books\": {",
        "\t\t\"book_x\": {",
        "\t\t\t\"order\": [\"a\",\"b\"],",
        "\t\t\t\"name\": \"Checkout\",",
        "\t\t\t\"x-owner\": \"squad-pay\",",
        "\t\t\t\"pages\": {",
        "\t\t\t\t\"a\": { \"title\": \"Context\", \"view\": \"moduleMap\", \"narrative\": \"\" },",
        "\t\t\t\t\"b\": {",
        "\t\t\t\t\t\"title\": \"The money\",",
        "\t\t\t\t\t\"view\": \"view_buy\",",
        "\t\t\t\t\t\"narrative\": \"Pay at the caf\\u00e9.\\n\\nThen \\\"leave\\\".\",",
        "\t\t\t\t\t\"x-speaker\": { \"who\": \"Bartosz\", \"minutes\": 2.50 },",
        "\t\t\t\t\t\"focus\": [\"mod_payment\"],",
        "\t\t\t\t\t\"frame\": \"focus\"",
        "\t\t\t\t}",
        "\t\t\t}",
        "\t\t},",
        "\t\t\"book_y\": { \"name\": \"Empty\", \"pages\": {} }",
        "\t}",
        "}");

    [Fact]
    public void Editing_a_page_narrative_changes_that_one_value()
    {
        SidecarPatch.Apply(MinimalBook, [Set(""" "Start wide, then narrow." """, "books", "book_a", "pages", "p1", "narrative")])
            .Should().Be("""
                {
                  "version": 1,
                  "books": {
                    "book_a": {
                      "name": "A walk",
                      "pages": {
                        "p1": {
                          "title": "The whole",
                          "view": "moduleMap",
                          "narrative": "Start wide, then narrow."
                        }
                      }
                    }
                  }
                }

                """);

        // Prose as people write it — a dash, quotes, a paragraph break — stays readable in a file
        // that has never escaped anything.
        SidecarPatch.Apply(RealisticBooks, [Set(""" "Only Payment Orchestration calls the provider — the gate never \"sees\" a card.\n\nAsk why." """,
                "books", "book_ticket_sold", "pages", "money", "narrative")])
            .Should().Be(Expect(RealisticBooks, (
                """Payment Orchestration is the only module allowed to call the provider.""",
                """Only Payment Orchestration calls the provider — the gate never \"sees\" a card.\n\nAsk why.""")));

        // A file that escapes gets its new prose escaped; the tabs, CRLF and missing final newline stay.
        SidecarPatch.Apply(HandwrittenBooks, [Set(""" "Pay at the café — by card.\n\nThen leave." """,
                "books", "book_x", "pages", "b", "narrative")])
            .Should().Be(Expect(HandwrittenBooks, (
                """caf\u00e9.\n\nThen \"leave\".""",
                """caf\u00E9 \u2014 by card.\n\nThen leave.""")));

        // A page written on one line keeps to its line.
        SidecarPatch.Apply(HandwrittenBooks, [Set(""" "Where it sits." """, "books", "book_x", "pages", "a", "narrative")])
            .Should().Be(Expect(HandwrittenBooks, ("\"narrative\": \"\" }", "\"narrative\": \"Where it sits.\" }")));
    }

    [Fact]
    public void Reordering_a_book_changes_only_its_order()
    {
        // A book that never had an order gains one, as its last member.
        SidecarPatch.Apply(MinimalBook, [Set("""["p1"]""", "books", "book_a", "order")])
            .Should().Be("""
                {
                  "version": 1,
                  "books": {
                    "book_a": {
                      "name": "A walk",
                      "pages": {
                        "p1": {
                          "title": "The whole",
                          "view": "moduleMap",
                          "narrative": "Start wide."
                        }
                      },
                      "order": [
                        "p1"
                      ]
                    }
                  }
                }

                """);

        SidecarPatch.Apply(RealisticBooks, [Set("""["context","money","path"]""", "books", "book_ticket_sold", "order")])
            .Should().Be(Expect(RealisticBooks, (
                """
                        "path",
                        "money"
                """,
                """
                        "money",
                        "path"
                """)));

        // An order written on one line is still one line: the reorder is a one-line diff.
        SidecarPatch.Apply(HandwrittenBooks, [Set("""["b","a"]""", "books", "book_x", "order")])
            .Should().Be(Expect(HandwrittenBooks, ("\"order\": [\"a\",\"b\"]", "\"order\": [\"b\",\"a\"]")));
    }

    [Fact]
    public void Adding_a_page_inserts_only_that_page_laid_out_like_the_pages_before_it()
    {
        SidecarPatch.Apply(MinimalBook, [Set("""{"title":"Closer","view":"dependencyGraph","focus":["mod_a"]}""", "books", "book_a", "pages", "p2")])
            .Should().Be("""
                {
                  "version": 1,
                  "books": {
                    "book_a": {
                      "name": "A walk",
                      "pages": {
                        "p1": {
                          "title": "The whole",
                          "view": "moduleMap",
                          "narrative": "Start wide."
                        },
                        "p2": {
                          "title": "Closer",
                          "view": "dependencyGraph",
                          "focus": [
                            "mod_a"
                          ]
                        }
                      }
                    }
                  }
                }

                """);

        SidecarPatch.Apply(RealisticBooks, [Set("""{"title":"What breaks first","view":"view_buy","narrative":"If the provider is down, the gate still sells.","focus":["ext_psp"],"others":"hide"}""",
                "books", "book_ticket_sold", "pages", "risk")])
            .Should().Be(Expect(RealisticBooks, (
                """
                          "others": "dim"
                        }
                """,
                """
                          "others": "dim"
                        },
                        "risk": {
                          "title": "What breaks first",
                          "view": "view_buy",
                          "narrative": "If the provider is down, the gate still sells.",
                          "focus": [
                            "ext_psp"
                          ],
                          "others": "hide"
                        }
                """)));

        SidecarPatch.Apply(HandwrittenBooks, [Set("""{"title":"Leaving","view":"dependencyGraph","narrative":"Le café ferme."}""", "books", "book_x", "pages", "c")])
            .Should().Be(Expect(HandwrittenBooks, (
                "\t\t\t\t\t\"frame\": \"focus\"\r\n\t\t\t\t}\r\n",
                "\t\t\t\t\t\"frame\": \"focus\"\r\n\t\t\t\t},\r\n" +
                "\t\t\t\t\"c\": {\r\n" +
                "\t\t\t\t\t\"title\": \"Leaving\",\r\n" +
                "\t\t\t\t\t\"view\": \"dependencyGraph\",\r\n" +
                "\t\t\t\t\t\"narrative\": \"Le caf\\u00E9 ferme.\"\r\n" +
                "\t\t\t\t}\r\n")));
    }

    [Fact]
    public void Removing_a_book_takes_only_that_book()
    {
        // The only book: the section stays, empty.
        SidecarPatch.Apply(MinimalBook, [Remove("books", "book_a")])
            .Should().Be("""
                {
                  "version": 1,
                  "books": {}
                }

                """);

        // Not the last: it, its comma and its line.
        SidecarPatch.Apply(RealisticBooks, [Remove("books", "book_onboarding")])
            .Should().Be(Expect(RealisticBooks, (
                """
                    "book_onboarding": {
                      "name": "Your first week",
                      "pages": {
                        "start": {
                          "title": "Start here",
                          "view": "dependencyGraph"
                        }
                      }
                    },
                    "book_ticket_sold": {
                """,
                """
                    "book_ticket_sold": {
                """)));

        // The last, written on one line: the comma before it, and it.
        SidecarPatch.Apply(HandwrittenBooks, [Remove("books", "book_y")])
            .Should().Be(Expect(HandwrittenBooks, (",\r\n\t\t\"book_y\": { \"name\": \"Empty\", \"pages\": {} }", "")));
    }

    // ---- a batch is one pass ------------------------------------------------------------------

    /// <summary>A sidecar the size a long-lived workspace grows to: views of positioned nodes and routed edges.</summary>
    private static string LargeSidecar(int views, int nodes)
    {
        var random = new Random(7);
        var sb = new System.Text.StringBuilder("{\n  \"version\": 1,\n  \"views\": {\n");
        for (var v = 0; v < views; v++)
        {
            sb.Append($"    \"custom:view_{v}\": {{\n      \"layoutMode\": \"custom\",\n      \"nodes\": {{\n");
            for (var n = 0; n < nodes; n++)
                sb.Append($"        \"element_{n:0000}\": {{\n          \"x\": {random.Next(4000)}.5,\n          \"y\": {random.Next(4000)}.25\n        }}{(n < nodes - 1 ? "," : "")}\n");
            sb.Append("      },\n      \"edges\": {\n");
            for (var n = 0; n < nodes; n++)
                sb.Append($"        \"link_{n:0000}\": {{ \"waypoints\": [{{ \"x\": 1.5, \"y\": 2.5 }}, {{ \"x\": 3.5, \"y\": 4.5 }}] }}{(n < nodes - 1 ? "," : "")}\n");
            sb.Append($"      }}\n    }}{(v < views - 1 ? "," : "")}\n");
        }
        return sb.Append("  }\n}\n").ToString();
    }

    [Fact]
    public void A_thousand_changes_to_a_large_file_are_one_pass_over_it()
    {
        // Every change parsed the whole file again, scanned it for its layout and copied it, all while
        // holding the file's lock: a thousand changes to 1.5 MB took 13 s, and an object set onto an
        // object took a pass per property.
        var text = LargeSidecar(views: 18, nodes: 500);
        text.Length.Should().BeGreaterThan(1_400_000);
        var changes = Enumerable.Range(0, 500).SelectMany(n => new[]
        {
            Set($"{n * 10}", "views", "custom:view_0", "nodes", $"element_{n:0000}", "x"),
            Set($"{n * 7}", "views", "custom:view_0", "nodes", $"element_{n:0000}", "y"),
        }).ToList();
        var nodes = "{" + string.Join(",", Enumerable.Range(0, 500).Select(n => $"\"element_{n:0000}\":{{\"x\":{n},\"y\":{n}}}")) + "}";

        var clock = System.Diagnostics.Stopwatch.StartNew();
        var leaves = SidecarPatch.Apply(text, changes);
        var whole = SidecarPatch.Apply(text, [Set(nodes, "views", "custom:view_1", "nodes")]);
        clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(3), "a batch is one pass, however many changes it holds");

        var view0 = JsonDocument.Parse(leaves).RootElement.GetProperty("views").GetProperty("custom:view_0").GetProperty("nodes");
        view0.GetProperty("element_0123").GetProperty("x").GetInt32().Should().Be(1230);
        view0.GetProperty("element_0123").GetProperty("y").GetInt32().Should().Be(861);
        var view1 = JsonDocument.Parse(whole).RootElement.GetProperty("views").GetProperty("custom:view_1").GetProperty("nodes");
        view1.GetProperty("element_0499").GetProperty("x").GetInt32().Should().Be(499);
    }

    [Fact]
    public void A_batch_writes_what_its_changes_write_one_at_a_time()
    {
        // The batch is one pass over the file; it must still lay out every change exactly as that
        // change alone would. Random changes to distinct paths, on files written both ways.
        var random = new Random(2026);
        foreach (var file in new[] { Written, Handwritten, LargeSidecar(views: 2, nodes: 6) })
        {
            var paths = Paths(JsonDocument.Parse(file).RootElement, []).ToList();
            for (var round = 0; round < 200; round++)
            {
                var batch = new List<SidecarChange>();
                for (var k = random.Next(1, 8); k > 0; k--)
                {
                    var change = RandomChange(random, paths);
                    if (batch.Any(c => Prefix(c.Path, change.Path) || Prefix(change.Path, c.Path))) continue;
                    batch.Add(change);
                }
                // Values before removals: an object whose members are all removed and replaced in one
                // batch gets the new ones in their place, as that order leaves it one at a time; the
                // other order would empty it to `{}` and then open it onto new lines.
                batch = [.. batch.Where(c => c.Value is not null), .. batch.Where(c => c.Value is null)];

                var oneAtATime = batch.Aggregate(file, (text, change) => SidecarPatch.Apply(text, [change]));
                SidecarPatch.Apply(file, batch).Should().Be(oneAtATime,
                    $"the batch [{string.Join("; ", batch.Select(c => $"{string.Join(".", c.Path)} = {c.Value?.GetRawText() ?? "(removed)"}"))}] says so");
            }
        }
    }

    private static bool Prefix(IReadOnlyList<string> a, IReadOnlyList<string> b) => a.Count <= b.Count && a.SequenceEqual(b.Take(a.Count));

    /// <summary>Every path of keys in the file, down to its leaves.</summary>
    private static IEnumerable<string[]> Paths(JsonElement element, string[] path)
    {
        if (path.Length > 0) yield return path;
        if (element.ValueKind != JsonValueKind.Object) yield break;
        foreach (var property in element.EnumerateObject())
            foreach (var inner in Paths(property.Value, [.. path, property.Name])) yield return inner;
    }

    private static SidecarChange RandomChange(Random random, List<string[]> paths)
    {
        var path = paths[random.Next(paths.Count)];
        // ASCII text only: a batch writes characters the way the file did when it was read, and one at a
        // time a removal that took the file's last escaped character would change that halfway through.
        string[] values = ["7", "\"Drawn, not modelled.\"", "{\"x\":1,\"y\":2}", "[1, 2]", "null", "{}", "{\"waypoints\":[{\"x\":1}]}"];
        var value = values[random.Next(values.Length)];
        return random.Next(5) switch
        {
            0 => Remove(path),
            1 => Remove([.. path, "missing"]),
            2 => Set(value, [.. path[..^1], $"new_{random.Next(1000)}"]),
            3 => Set(value, [.. path[..^1], $"new_{random.Next(1000)}", "deeper", "still"]),
            _ => Set(value, path),
        };
    }
}
