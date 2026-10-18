using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// Guards <c>schema/stemma.layout.schema.json</c> against the type it documents.
///
/// The schema is hand-maintained — generating it from the TypeScript types would be a build step
/// nobody runs — so the risk is that it quietly stops describing reality. These tests do not
/// validate documents against the schema (that needs a dependency this project does not carry);
/// they check the two ways the pair can drift: a section added to the C# type and forgotten in the
/// schema, and a version or URL bumped in one place only.
/// </summary>
public sealed class LayoutSchemaTests
{
    private static string SchemaPath([CallerFilePath] string file = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(file)!, "..", "..", "schema", "stemma.layout.schema.json"));

    private static JsonDocument Schema() => JsonDocument.Parse(File.ReadAllText(SchemaPath()));

    private static string TempDir() => Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-schema-{Guid.NewGuid():N}")).FullName;

    [Fact]
    public void Schema_file_exists_and_is_valid_json()
    {
        File.Exists(SchemaPath()).Should().BeTrue("the format is authored by hand by people and agents who never open the app");
        using var doc = Schema();
        doc.RootElement.GetProperty("$schema").GetString().Should().StartWith("https://json-schema.org/draft/");
    }

    [Fact]
    public void Schema_documents_every_section_the_engine_models()
    {
        using var doc = Schema();
        var documented = doc.RootElement.GetProperty("properties").EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);

        var modelled = typeof(LayoutSidecar)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name)
            .Where(n => n is not null)
            .Select(n => n!);

        // Extension data has no JsonPropertyName and is intentionally absent from this list: it is
        // the *absence* of a declared name, and the schema expresses it as additionalProperties.
        modelled.Where(n => !documented.Contains(n)).Should().BeEmpty(
            "a section the engine persists but the schema omits is a section nobody can author by hand");
    }

    [Fact]
    public void Schema_keeps_the_format_open_because_the_format_is_pass_through()
    {
        using var doc = Schema();
        var root = doc.RootElement;

        root.GetProperty("additionalProperties").GetBoolean().Should().BeTrue();
        root.GetProperty("$defs").GetProperty("viewLayout").GetProperty("additionalProperties").GetBoolean()
            .Should().BeTrue("this is the object B-001 truncated; a schema that forbade unknown members would bless the bug");
        root.GetProperty("$defs").GetProperty("edgeEntry").GetProperty("additionalProperties").GetBoolean()
            .Should().BeTrue();
        foreach (var def in new[] { "book", "bookPage" })
            root.GetProperty("$defs").GetProperty(def).GetProperty("additionalProperties").GetBoolean()
                .Should().BeTrue($"the client owns the schema of {def}, and a key it adds must survive an older reader");
    }

    [Fact]
    public void Schema_describes_books_although_the_engine_does_not_model_them()
    {
        // The engine keeps `books` as extension data (ADR-0022), so the check against LayoutSidecar
        // above cannot see it. The shape is the one lib/books.ts reads and `stemma validate` checks.
        using var doc = Schema();
        var root = doc.RootElement;
        var defs = root.GetProperty("$defs");

        root.GetProperty("properties").GetProperty("books").GetProperty("additionalProperties").GetProperty("$ref").GetString()
            .Should().Be("#/$defs/book");

        var book = defs.GetProperty("book");
        book.GetProperty("required").EnumerateArray().Select(e => e.GetString()).Should().BeEquivalentTo(["name", "pages"]);
        book.GetProperty("properties").GetProperty("order").GetProperty("items").GetProperty("type").GetString().Should().Be("string");
        book.GetProperty("properties").GetProperty("pages").GetProperty("additionalProperties").GetProperty("$ref").GetString()
            .Should().Be("#/$defs/bookPage", "pages are keyed by id, not a list, so one narrative is one change");

        var page = defs.GetProperty("bookPage");
        page.GetProperty("required").EnumerateArray().Select(e => e.GetString()).Should().BeEquivalentTo(["title", "view"]);
        var members = page.GetProperty("properties");
        members.GetProperty("frame").GetProperty("enum").EnumerateArray().Select(e => e.GetString()).Should().BeEquivalentTo(["view", "focus"]);
        members.GetProperty("others").GetProperty("enum").EnumerateArray().Select(e => e.GetString()).Should().BeEquivalentTo(["dim", "hide"]);
        members.GetProperty("focus").GetProperty("items").GetProperty("type").GetString().Should().Be("string");
    }

    [Fact]
    public void Schema_declares_the_version_the_engine_writes()
    {
        using var doc = Schema();
        var declared = doc.RootElement.GetProperty("properties").GetProperty("version").GetProperty("const").GetInt32();
        declared.Should().Be(new LayoutSidecar().Version,
            "bumping the sidecar version without the schema leaves editors validating against the old shape");
    }

    [Fact]
    public void Schema_url_in_the_engine_matches_the_schema_id()
    {
        using var doc = Schema();
        doc.RootElement.GetProperty("$id").GetString().Should().Be(LayoutSidecar.SchemaUrl,
            "the pointer stamped into every sidecar has to resolve to this file");
    }

    [Fact]
    public void Write_stamps_the_schema_pointer_but_never_overwrites_one()
    {
        var dir = TempDir();
        try
        {
            new LayoutSidecar().Write(dir);
            LayoutSidecar.Read(dir).Schema.Should().Be(LayoutSidecar.SchemaUrl);

            // A workspace may deliberately pin its own copy — a vendored file, a pinned tag.
            const string pinned = "./vendor/stemma.layout.schema.json";
            var custom = LayoutSidecar.Read(dir);
            custom.Schema = pinned;
            custom.Write(dir);
            LayoutSidecar.Read(dir).Schema.Should().Be(pinned);
        }
        finally { Directory.Delete(dir, recursive: true); }
    }
}
