using System.Buffers.Binary;
using FluentAssertions;
using Xunit;

namespace Stemma.Cli.Tests;

/// <summary>
/// B-003 shipped an opaque PNG under a manifest that recorded `transparent: true`, because the
/// manifest copied the request instead of reading the file. These tests cover the reading — the part
/// that has to be right for the manifest to be provenance rather than an echo.
///
/// The fixtures are hand-built byte arrays rather than rendered files: the header is the whole
/// contract, and a test that needs a browser to produce its input tests something else.
/// </summary>
public class PngFactsTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("stemma-png").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private string WritePng(string name, byte colourType, params string[] extraChunks)
    {
        var bytes = new List<byte> { 0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A };
        bytes.AddRange(Chunk("IHDR", [.. Be(1), .. Be(1), 8, colourType, 0, 0, 0]));
        foreach (var chunk in extraChunks) bytes.AddRange(Chunk(chunk, [0]));
        bytes.AddRange(Chunk("IEND", []));

        var path = Path.Combine(_dir, name);
        File.WriteAllBytes(path, [.. bytes]);
        return path;

        static byte[] Be(uint v) { var b = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(b, v); return b; }
        static byte[] Chunk(string type, byte[] data) =>
            [.. Be((uint)data.Length), .. System.Text.Encoding.ASCII.GetBytes(type), .. data, 0, 0, 0, 0];
    }

    [Theory]
    [InlineData(6)] // truecolour + alpha — what a transparent Playwright screenshot writes
    [InlineData(4)] // greyscale + alpha
    public void Reports_alpha_for_colour_types_that_carry_a_channel(byte colourType) =>
        PngFacts.HasAlpha(WritePng("a.png", colourType)).Should().BeTrue();

    [Theory]
    [InlineData(0)] // greyscale
    [InlineData(2)] // truecolour — what `--opaque` writes, and what B-003 wrote by mistake
    public void Reports_no_alpha_for_opaque_colour_types(byte colourType) =>
        PngFacts.HasAlpha(WritePng("o.png", colourType)).Should().BeFalse();

    [Fact]
    public void Treats_a_palette_with_tRNS_as_transparent() =>
        PngFacts.HasAlpha(WritePng("p.png", 3, "PLTE", "tRNS")).Should().BeTrue();

    [Fact]
    public void Treats_a_palette_without_tRNS_as_opaque() =>
        PngFacts.HasAlpha(WritePng("p.png", 3, "PLTE")).Should().BeFalse();

    [Fact]
    public void Walks_the_chunk_list_rather_than_searching_the_bytes()
    {
        // "tRNS" appearing inside another chunk's payload is not a tRNS chunk. Searching the raw
        // bytes would call this transparent, and compressed image data is arbitrary bytes.
        var path = WritePng("decoy.png", 3, "PLTE");
        var bytes = File.ReadAllBytes(path).ToList();
        var idat = new List<byte> { 0, 0, 0, 4 };
        idat.AddRange("IDAT"u8.ToArray());
        idat.AddRange("tRNS"u8.ToArray());
        idat.AddRange([0, 0, 0, 0]);
        bytes.InsertRange(bytes.Count - 12, idat);
        File.WriteAllBytes(path, [.. bytes]);

        PngFacts.HasAlpha(path).Should().BeFalse();
    }

    [Fact]
    public void Reads_the_dimensions_from_the_header() =>
        PngFacts.Size(WritePng("s.png", 6)).Should().Be((1, 1));

    [Fact]
    public void Reports_no_dimensions_for_a_file_that_is_not_a_png()
    {
        var path = Path.Combine(_dir, "no.png");
        File.WriteAllText(path, "not a png");

        PngFacts.Size(path).Should().BeNull();
    }

    [Fact]
    public void Returns_null_for_a_file_that_is_not_a_png()
    {
        var path = Path.Combine(_dir, "not.png");
        File.WriteAllText(path, "<svg xmlns='http://www.w3.org/2000/svg'></svg>");

        // Not `false`: "unreadable" and "opaque" are different answers, and reporting the second
        // would put a fresh untrue claim in the manifest in place of the one B-003 removed.
        PngFacts.HasAlpha(path).Should().BeNull();
    }

    [Fact]
    public void Returns_null_for_a_truncated_png() =>
        PngFacts.HasAlpha(WriteRaw("cut.png", [0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]))
            .Should().BeNull();

    [Fact]
    public void Returns_null_for_a_missing_file() =>
        PngFacts.HasAlpha(Path.Combine(_dir, "absent.png")).Should().BeNull();

    private string WriteRaw(string name, byte[] bytes)
    {
        var path = Path.Combine(_dir, name);
        File.WriteAllBytes(path, bytes);
        return path;
    }
}
