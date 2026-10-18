using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using FluentAssertions;
using Stemma.Web.Services;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// A book's PDF is a cover and one landscape page per book page (F-013 AC10). Pages are counted from
/// the page objects in the file: QuestPDF writes them uncompressed and without object streams, and
/// the count was checked against QuestPDF's own page-by-page rendering when this was written.
/// </summary>
public sealed partial class BookPdfExporterTests
{
    private static readonly DateTimeOffset Exported = new(2026, 10, 18, 9, 30, 0, TimeSpan.Zero);

    private static BookPdfExporter.PdfBook Book(params BookPdfExporter.PdfBookPage[] pages) =>
        new("How a Ticket Is Sold", "engineering", Exported, pages);

    private static BookPdfExporter.PdfBookPage Page(string title, string narrative = "", byte[]? png = null) =>
        new(title, narrative, png);

    [GeneratedRegex(@"/Type\s*/Page\b")]
    private static partial Regex PageObject();

    private static int PageCount(byte[] pdf) => PageObject().Matches(Encoding.Latin1.GetString(pdf)).Count;

    [Fact]
    public void Render_emits_a_pdf()
    {
        var bytes = BookPdfExporter.Render(Book(Page("The path a purchase takes", "Follow the arrows.")));

        Encoding.ASCII.GetString(bytes, 0, 4).Should().Be("%PDF");
    }

    [Fact]
    public void Render_makes_a_cover_and_one_page_per_book_page()
    {
        var bytes = BookPdfExporter.Render(Book(
            Page("Context", "The system and who uses it."),
            Page("Modules", "", TinyPng.Gradient(64, 40)),
            Page("Where the money moves", "Payment Orchestration is the only module allowed to call the PSP.", TinyPng.Gradient(64, 40))));

        PageCount(bytes).Should().Be(4);
    }

    [Fact]
    public void Render_of_an_empty_book_is_the_cover_alone()
    {
        var bytes = BookPdfExporter.Render(new BookPdfExporter.PdfBook("Empty", null, Exported, []));

        Encoding.ASCII.GetString(bytes, 0, 4).Should().Be("%PDF");
        PageCount(bytes).Should().Be(1);
    }

    [Fact]
    public void Render_carries_the_capture_into_the_page()
    {
        var without = BookPdfExporter.Render(Book(Page("Context", "narrative")));
        var with = BookPdfExporter.Render(Book(Page("Context", "narrative", TinyPng.Gradient(64, 40))));

        with.Length.Should().BeGreaterThan(without.Length);
    }

    [Fact]
    public void Render_keeps_a_long_narrative_on_its_own_page()
    {
        var essay = string.Join("\n\n", Enumerable.Repeat(
            "A narrative that goes on far longer than one slide should, because architects have a lot to say.", 120));

        var bytes = BookPdfExporter.Render(Book(Page("Long", essay), Page("Short", "One line.")));

        PageCount(bytes).Should().Be(3);
    }

    [Fact]
    public void Render_leaves_out_a_capture_that_is_not_a_picture()
    {
        var bytes = BookPdfExporter.Render(Book(Page("Context", "narrative", [1, 2, 3, 4, 5])));

        PageCount(bytes).Should().Be(2);
    }

    [Fact]
    public void Render_handles_a_page_with_neither_picture_nor_narrative()
    {
        PageCount(BookPdfExporter.Render(Book(Page("A divider")))).Should().Be(2);
    }

    [Fact]
    public void ReadCapture_decodes_base64_and_a_data_url()
    {
        var png = TinyPng.Gradient(4, 4);
        var base64 = Convert.ToBase64String(png);

        BookPdfExporter.ReadCapture(base64).Should().Equal(png);
        BookPdfExporter.ReadCapture("data:image/png;base64," + base64).Should().Equal(png);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not base64 at all!")]
    [InlineData("data:image/png;base64,%%%")]
    public void ReadCapture_is_null_for_nothing_or_not_base64(string? sent)
    {
        BookPdfExporter.ReadCapture(sent).Should().BeNull();
    }
}

/// <summary>A real PNG, made here so the tests carry no binary fixture: an RGB gradient, unfiltered.</summary>
internal static class TinyPng
{
    public static byte[] Gradient(int width, int height)
    {
        var raw = new byte[height * (1 + width * 3)];
        for (var y = 0; y < height; y++)
        {
            var row = y * (1 + width * 3);
            for (var x = 0; x < width; x++)
            {
                raw[row + 1 + x * 3] = (byte)(x * 255 / width);
                raw[row + 2 + x * 3] = (byte)(y * 255 / height);
                raw[row + 3 + x * 3] = 128;
            }
        }

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
            zlib.Write(raw);

        var header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height);
        header[8] = 8; // bit depth
        header[9] = 2; // colour type: RGB

        using var png = new MemoryStream();
        png.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        Chunk(png, "IHDR", header);
        Chunk(png, "IDAT", compressed.ToArray());
        Chunk(png, "IEND", []);
        return png.ToArray();
    }

    private static void Chunk(Stream png, string type, byte[] data)
    {
        Span<byte> word = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(word, data.Length);
        png.Write(word);
        var typed = Encoding.ASCII.GetBytes(type).Concat(data).ToArray();
        png.Write(typed);
        BinaryPrimitives.WriteUInt32BigEndian(word, Crc32(typed));
        png.Write(word);
    }

    private static uint Crc32(byte[] bytes)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in bytes)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++)
                crc = (crc & 1) != 0 ? 0xEDB88320u ^ (crc >> 1) : crc >> 1;
        }
        return ~crc;
    }
}
