using FluentAssertions;
using Verso.Engine.Adapters.Yaml;
using Xunit;

namespace Verso.Engine.Tests;

public sealed class ViewBookOpsTests
{
    private const string BookFile = "view-book.verso.yaml";

    private static (string Dir, YamlAdapter Adapter) NewWorkspace()
    {
        var dir = Path.Combine(Path.GetTempPath(), "verso-book-" + Guid.NewGuid());
        Directory.CreateDirectory(Path.Combine(dir, "Concepts"));
        return (dir, YamlAdapter.Load(dir));
    }

    [Theory]
    [InlineData("book-minimal.verso.yaml")]
    [InlineData("book-realistic.verso.yaml")]
    [InlineData("book-pathological.verso.yaml")]
    public void Fixture_round_trips_byte_identical(string fixture)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "yaml", fixture);
        var original = File.ReadAllText(path);
        var parsed = YamlConceptReader.Parse(path, original);
        var rendered = YamlConceptWriter.Render(parsed);
        rendered.Should().Be(original);
    }

    [Fact]
    public void AddBook_appends_to_books_section()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            YamlMutations.AddBook(adapter, BookFile, "book_x", "X", audience: "engineering");
            adapter.Save(adapter.Files[BookFile]);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", BookFile));
            saved.Should().Contain("books:");
            saved.Should().Contain("  - id: book_x");
            saved.Should().Contain("    name: X");
            saved.Should().Contain("    audience: engineering");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void AddBook_rejects_duplicate_id()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            YamlMutations.AddBook(adapter, BookFile, "book_x", "X");
            var act = () => YamlMutations.AddBook(adapter, BookFile, "book_x", "X2");
            act.Should().Throw<InvalidOperationException>().WithMessage("*already present*");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void AddBookPage_serialises_into_pages_list()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            var book = YamlMutations.AddBook(adapter, BookFile, "book_x", "X");
            YamlMutations.AddBookPage(book, "c4Context", "Context", "Start here.");
            YamlMutations.AddBookPage(book, "moduleMap", "Modules", "Each tile = a module.");
            adapter.Save(adapter.Files[BookFile]);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", BookFile));
            saved.Should().Contain("      - viewId: c4Context");
            saved.Should().Contain("        title: Context");
            saved.Should().Contain("        narrative: Start here.");
            saved.Should().Contain("      - viewId: moduleMap");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void ReorderBookPages_permutes_in_place()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            var book = YamlMutations.AddBook(adapter, BookFile, "book_x", "X");
            YamlMutations.AddBookPage(book, "c4Context", "A");
            YamlMutations.AddBookPage(book, "moduleMap", "B");
            YamlMutations.AddBookPage(book, "dependencyGraph", "C");
            YamlMutations.ReorderBookPages(book, new[] { 2, 0, 1 });
            book.Pages[0].Title.Should().Be("C");
            book.Pages[1].Title.Should().Be("A");
            book.Pages[2].Title.Should().Be("B");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void ReorderBookPages_rejects_wrong_length()
    {
        var book = new YamlBookEntry();
        book.Pages.Add(new YamlBookPage { ViewId = "c4Context", Title = "A" });
        book.Pages.Add(new YamlBookPage { ViewId = "moduleMap", Title = "B" });
        var act = () => YamlMutations.ReorderBookPages(book, new[] { 0 });
        act.Should().Throw<ArgumentException>().WithMessage("*length 1 must equal page count 2*");
    }

    [Fact]
    public void ReorderBookPages_rejects_duplicates()
    {
        var book = new YamlBookEntry();
        book.Pages.Add(new YamlBookPage { ViewId = "c4Context", Title = "A" });
        book.Pages.Add(new YamlBookPage { ViewId = "moduleMap", Title = "B" });
        var act = () => YamlMutations.ReorderBookPages(book, new[] { 0, 0 });
        act.Should().Throw<ArgumentException>().WithMessage("*duplicate indices*");
    }

    [Fact]
    public void SetBookPageNarrative_updates_only_the_target_page()
    {
        var (_, adapter) = NewWorkspace();
        var book = YamlMutations.AddBook(adapter, BookFile, "book_x", "X");
        YamlMutations.AddBookPage(book, "c4Context", "A", "original A");
        YamlMutations.AddBookPage(book, "moduleMap", "B", "original B");
        YamlMutations.SetBookPageNarrative(book, 1, "revised B");
        book.Pages[0].Narrative.Should().Be("original A");
        book.Pages[1].Narrative.Should().Be("revised B");
    }

    [Fact]
    public void RemoveBookPage_drops_the_indexed_page()
    {
        var (_, adapter) = NewWorkspace();
        var book = YamlMutations.AddBook(adapter, BookFile, "book_x", "X");
        YamlMutations.AddBookPage(book, "c4Context", "A");
        YamlMutations.AddBookPage(book, "moduleMap", "B");
        YamlMutations.AddBookPage(book, "dependencyGraph", "C");
        YamlMutations.RemoveBookPage(book, 1);
        book.Pages.Should().HaveCount(2);
        book.Pages[0].Title.Should().Be("A");
        book.Pages[1].Title.Should().Be("C");
    }

    [Fact]
    public void RenameBook_only_changes_name_field()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            var book = YamlMutations.AddBook(adapter, BookFile, "book_x", "Old");
            YamlMutations.AddBookPage(book, "c4Context", "P1");
            adapter.Save(adapter.Files[BookFile]);
            YamlMutations.RenameBook(book, "New");
            adapter.Save(adapter.Files[BookFile]);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", BookFile));
            saved.Should().Contain("    name: New");
            saved.Should().NotContain("    name: Old");
            saved.Should().Contain("  - id: book_x");
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void RemoveBook_strips_entry_but_preserves_siblings()
    {
        var (dir, adapter) = NewWorkspace();
        try
        {
            var file = adapter.GetOrCreate(BookFile);
            YamlMutations.AddBook(adapter, BookFile, "book_a", "A");
            YamlMutations.AddBook(adapter, BookFile, "book_b", "B");
            adapter.Save(file);
            YamlMutations.RemoveBook(file, "book_a");
            adapter.Save(file);
            var saved = File.ReadAllText(Path.Combine(dir, "Concepts", BookFile));
            saved.Should().NotContain("id: book_a");
            saved.Should().Contain("id: book_b");
        }
        finally { Directory.Delete(dir, true); }
    }
}
