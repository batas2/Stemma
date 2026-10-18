using System.Globalization;
using QuestPDF.Drawing.Exceptions;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Stemma.Web.Services;

/// <summary>
/// A book as a deck (F-013 AC10): a cover, then one landscape page per book page with the diagram
/// as it was presented, its title and its narrative. The diagram is the client's capture of the
/// canvas on that page, focus, dimming and frame included, because the canvas is the only thing that
/// knows what a page looks like; this only lays the pages out. A page without a capture is still a
/// page: its title and its narrative.
/// </summary>
public static class BookPdfExporter
{
    static BookPdfExporter()
    {
        // QuestPDF renders nothing until a licence is declared. Community is its free licence, for
        // individuals and for organisations below its revenue threshold
        // (https://www.questpdf.com/license/), and is the one this build runs under; whoever runs
        // Stemma above that threshold needs a QuestPDF licence of their own. Declared once, on first
        // use, so the tests and the app run under the same one.
        QuestPDF.Settings.License = LicenseType.Community;
    }

    /// <summary>The most pages one export renders. A book is a walk through a model, not an archive.</summary>
    public const int MaxPages = 200;

    /// <summary>The largest capture one page may carry, once decoded.</summary>
    public const int MaxCaptureBytes = 15 * 1024 * 1024;

    /// <summary>
    /// The largest request the export accepts. The server's default of about 30 MB is a few
    /// full-resolution captures once base64 has grown them by a third, which a real book exceeds.
    /// </summary>
    public const long MaxRequestBytes = 128L * 1024 * 1024;

    public sealed record PdfBookPage(string Title, string Narrative, byte[]? CapturePng);

    public sealed record PdfBook(string Name, string? Audience, DateTimeOffset ExportedAt, IReadOnlyList<PdfBookPage> Pages);

    private const float Margin = 32;
    private const string Website = "https://bfrackowiak.pl/stemma/";

    /// <summary>
    /// A page's capture as the client sent it, as bytes; null when there is none or it is not base64.
    /// A picture that cannot be read costs the page its picture, never the whole export. The data
    /// URL prefix the browser puts on a capture is accepted and dropped.
    /// </summary>
    public static byte[]? ReadCapture(string? base64)
    {
        if (string.IsNullOrWhiteSpace(base64)) return null;
        var comma = base64.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ? base64.IndexOf(',') : -1;
        var payload = comma >= 0 ? base64[(comma + 1)..] : base64;
        try
        {
            return Convert.FromBase64String(payload);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public static byte[] Render(PdfBook book)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                Setup(page);
                page.Content().Column(col =>
                {
                    col.Item().Text(book.Name).FontSize(32).Bold();
                    if (!string.IsNullOrWhiteSpace(book.Audience))
                        col.Item().PaddingTop(4).Text($"Audience: {book.Audience}").FontSize(13).FontColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(4)
                        .Text($"Exported {book.ExportedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}")
                        .FontSize(11).FontColor(Colors.Grey.Medium);
                    col.Item().PaddingVertical(16).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten2);

                    if (book.Pages.Count == 0)
                        col.Item().Text("This book has no pages yet.").Italic().FontColor(Colors.Grey.Medium);
                    for (var i = 0; i < book.Pages.Count; i++)
                        col.Item().PaddingBottom(4).Text($"{i + 1}. {book.Pages[i].Title}").FontSize(12);
                });
                page.Footer().AlignCenter().Text(t =>
                {
                    t.DefaultTextStyle(s => s.FontSize(9).FontColor(Colors.Grey.Medium));
                    t.Span("Made with Stemma — ");
                    t.Hyperlink(Website, Website);
                });
            });

            for (var i = 0; i < book.Pages.Count; i++)
            {
                var bookPage = book.Pages[i];
                var position = $"{i + 1} / {book.Pages.Count}";
                container.Page(page =>
                {
                    Setup(page);
                    page.Header().PaddingBottom(12).Row(row =>
                    {
                        row.RelativeItem().Text(bookPage.Title).FontSize(20).Bold();
                        row.AutoItem().PaddingLeft(16).AlignMiddle().Text(position).FontSize(10).FontColor(Colors.Grey.Medium);
                    });
                    page.Content().PaddingBottom(12).Element(c => Body(c, Picture(bookPage.CapturePng), NarrativeText.Plain(bookPage.Narrative)));
                    page.Footer().AlignCenter().Text(t =>
                    {
                        t.DefaultTextStyle(s => s.FontSize(9).FontColor(Colors.Grey.Medium));
                        t.Span("Stemma · page ");
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

    private static void Setup(PageDescriptor page)
    {
        page.Size(PageSizes.A4.Landscape());
        page.Margin(Margin);
        // Without ligatures, because a reader searches the handout and copies out of it, and a viewer
        // that cannot map "ti" back to two letters finds no "Notification" in it.
        page.DefaultTextStyle(t => t.FontSize(11).FontColor(Colors.Grey.Darken4).DisableFontFeature(FontFeatures.StandardLigatures));
    }

    /// <summary>
    /// The picture beside the words when the page has both, the picture alone across the page when it
    /// has no narrative, the narrative across the page when it has no picture. The narrative is scaled
    /// down rather than allowed to run onto a second sheet, so a book page is always one PDF page.
    /// </summary>
    private static void Body(IContainer content, Image? picture, string narrative)
    {
        if (picture is not null && narrative.Length > 0)
            content.Row(row =>
            {
                row.Spacing(20);
                row.RelativeItem(7).Element(c => Diagram(c, picture));
                row.RelativeItem(3).Element(c => Narrative(c, narrative));
            });
        else if (picture is not null)
            Diagram(content, picture);
        else if (narrative.Length > 0)
            Narrative(content, narrative);
    }

    // The capture is embedded as it came: re-encoding a diagram as JPEG, which QuestPDF does to an
    // opaque image by default, blurs exactly the small labels a reader needs.
    private static void Diagram(IContainer c, Image picture) =>
        c.ExtendVertical().AlignCenter().AlignMiddle().Image(picture).UseOriginalImage().FitArea();

    private static void Narrative(IContainer c, string text) =>
        c.ScaleToFit().Text(text).FontSize(12).LineHeight(1.4f);

    /// <summary>The capture as an image QuestPDF can draw, or null when there is none or it is not a picture.</summary>
    private static Image? Picture(byte[]? png)
    {
        if (png is not { Length: > 0 }) return null;
        try
        {
            return Image.FromBinaryData(png);
        }
        catch (DocumentComposeException)
        {
            return null;
        }
    }
}
