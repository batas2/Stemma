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
}
