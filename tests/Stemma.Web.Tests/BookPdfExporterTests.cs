using System.Text;
using FluentAssertions;
using Stemma.Web.Services;
using Xunit;

namespace Stemma.Web.Tests;

public sealed class BookPdfExporterTests
{
    [Fact]
    public void Render_emits_valid_pdf_with_header()
    {
        var book = new BookPdfExporter.PdfBook("Sample", "engineering", new[]
        {
            new BookPdfExporter.PdfBookPage("c4Context", "Page A", "narrative A", null),
            new BookPdfExporter.PdfBookPage("moduleMap", "Page B", "narrative B", null),
        });
        var bytes = BookPdfExporter.Render(book);
        bytes.Length.Should().BeGreaterThan(500);
        Encoding.ASCII.GetString(bytes, 0, 4).Should().Be("%PDF");
    }

    [Fact]
    public void Render_handles_empty_pages_list_without_throwing()
    {
        var book = new BookPdfExporter.PdfBook("Empty", null, Array.Empty<BookPdfExporter.PdfBookPage>());
        var bytes = BookPdfExporter.Render(book);
        bytes.Length.Should().BeGreaterThan(0);
        Encoding.ASCII.GetString(bytes, 0, 4).Should().Be("%PDF");
    }

    [Fact]
    public void Render_handles_blank_narrative_and_missing_capture()
    {
        var book = new BookPdfExporter.PdfBook("Sparse", null, new[]
        {
            new BookPdfExporter.PdfBookPage("c4Context", "P1", "", null),
        });
        var bytes = BookPdfExporter.Render(book);
        Encoding.ASCII.GetString(bytes, 0, 4).Should().Be("%PDF");
    }

    [Fact]
    public void Render_produces_more_bytes_when_there_are_more_pages()
    {
        var one = BookPdfExporter.Render(new BookPdfExporter.PdfBook("X", null, new[]
        {
            new BookPdfExporter.PdfBookPage("c4Context", "P1", "narr", null),
        }));
        var three = BookPdfExporter.Render(new BookPdfExporter.PdfBook("X", null, new[]
        {
            new BookPdfExporter.PdfBookPage("c4Context", "P1", "narr", null),
            new BookPdfExporter.PdfBookPage("moduleMap", "P2", "narr", null),
            new BookPdfExporter.PdfBookPage("dependencyGraph", "P3", "narr", null),
        }));
        three.Length.Should().BeGreaterThan(one.Length);
    }
}
