using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Stemma.Web.Services;

/// <summary>
/// Epic 08 Track A (A8) — multi-page PDF export of a View Book via QuestPDF.
/// Each page in the book becomes one PDF page with a title, a viewId hint, and
/// the narrative. The diagram capture itself is provided by the client as a PNG
/// blob keyed by page index; if a page has no capture, that PDF page renders
/// title + narrative only (still useful for governance reviews).
/// </summary>
public static class BookPdfExporter
{
    static BookPdfExporter()
    {
        // QuestPDF community license — see docs/decisions/0011-yaml-adapter-shape.md
        // (We pin the runtime once on first use; tests and production share the binding.)
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public sealed record PdfBookPage(string ViewId, string Title, string Narrative, byte[]? CapturePng);

    public sealed record PdfBook(string Name, string? Audience, IReadOnlyList<PdfBookPage> Pages);

    public static byte[] Render(PdfBook book)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Margin(40);
                page.Size(PageSizes.A4);
                page.DefaultTextStyle(t => t.FontSize(11));
                page.Header().Column(col =>
                {
                    col.Item().Text(book.Name).FontSize(28).Bold();
                    if (!string.IsNullOrWhiteSpace(book.Audience))
                        col.Item().Text($"Audience: {book.Audience}").FontSize(10).Italic().FontColor(Colors.Grey.Medium);
                    col.Item().PaddingTop(10).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                });
                page.Content().PaddingTop(20).Column(col =>
                {
                    col.Item().Text("Pages").FontSize(14).SemiBold();
                    for (var i = 0; i < book.Pages.Count; i++)
                    {
                        var p = book.Pages[i];
                        col.Item().PaddingTop(4).Text($"{i + 1}. {p.Title}").FontSize(11);
                    }
                    if (book.Pages.Count == 0)
                        col.Item().PaddingTop(8).Text("(this book has no pages yet)").FontColor(Colors.Grey.Medium).Italic();
                });
                page.Footer().AlignCenter().Text(t =>
                {
                    t.Span("Stemma · ");
                    t.CurrentPageNumber();
                    t.Span(" / ");
                    t.TotalPages();
                });
            });

            for (var i = 0; i < book.Pages.Count; i++)
            {
                var bp = book.Pages[i];
                var pageIndex = i;
                container.Page(page =>
                {
                    page.Margin(40);
                    page.Size(PageSizes.A4);
                    page.Header().Column(col =>
                    {
                        col.Item().Row(row =>
                        {
                            row.RelativeItem().Text(bp.Title).FontSize(22).Bold();
                            row.ConstantItem(80).AlignRight().Text($"{pageIndex + 1} / {book.Pages.Count}")
                                .FontSize(9).FontColor(Colors.Grey.Medium);
                        });
                        col.Item().Text($"view: {bp.ViewId}").FontSize(9).Italic().FontColor(Colors.Grey.Medium);
                        col.Item().PaddingTop(6).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);
                    });
                    page.Content().PaddingTop(15).Column(col =>
                    {
                        if (bp.CapturePng is { Length: > 0 } png)
                            col.Item().PaddingBottom(15).MaxHeight(360).AlignCenter().Image(png);
                        col.Item().Text(string.IsNullOrWhiteSpace(bp.Narrative) ? "(no narrative)" : bp.Narrative)
                            .FontSize(11).LineHeight(1.4f);
                    });
                    page.Footer().AlignCenter().Text(t =>
                    {
                        t.Span("Stemma · ");
                        t.CurrentPageNumber();
                        t.Span(" / ");
                        t.TotalPages();
                    });
                });
            }
        });

        using var stream = new MemoryStream();
        document.GeneratePdf(stream);
        return stream.ToArray();
    }
}
