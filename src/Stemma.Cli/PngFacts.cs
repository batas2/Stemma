namespace Stemma.Cli;

/// <summary>
/// What a written PNG actually is, read back from the file.
///
/// This exists because of B-003. The manifest recorded <c>transparent: true</c> next to a PNG that
/// had no alpha channel at all: the value was a copy of the request, and the request had stopped
/// describing the artefact. A provenance record derived from intent rather than from the file is not
/// provenance — <c>render --check</c> is worth having only if the manifest can be trusted over the
/// thing it sits beside.
///
/// A PNG's header is enough and needs no image library. The signature is eight bytes, and the first
/// chunk must be IHDR, whose colour type byte says whether an alpha channel exists.
/// </summary>
public static class PngFacts
{
    private static ReadOnlySpan<byte> Signature => [0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>Colour type byte in IHDR: 8 signature + 4 length + 4 type + 8 width/height + 1 bit depth.</summary>
    private const int ColourTypeOffset = 25;

    /// <summary>Bit 2 of the colour type is the alpha channel (types 4 and 6 carry one).</summary>
    private const byte AlphaChannelBit = 4;

    /// <summary>Colour type 3 is a palette, whose transparency lives in an optional tRNS chunk instead.</summary>
    private const byte PaletteColourType = 3;

    /// <summary>
    /// True when the file can express a transparent pixel — an alpha channel, or a palette with a
    /// tRNS chunk. False for an opaque encoding. Null when the file is not a PNG we can read, which
    /// keeps a malformed or truncated file from being reported as a definite answer either way.
    /// </summary>
    public static bool? HasAlpha(string path)
    {
        if (ReadHeader(path) is not { } bytes) return null;

        var colourType = bytes[ColourTypeOffset];
        if ((colourType & AlphaChannelBit) != 0) return true;
        return colourType == PaletteColourType && HasChunk(bytes, "tRNS");
    }

    /// <summary>
    /// The pixel dimensions from the header, or null when the file is not a readable PNG. Reading
    /// the artefact rather than parsing the numbers back out of the command's own stdout, which is a
    /// report of the artefact and not the thing itself.
    /// </summary>
    public static (int Width, int Height)? Size(string path)
    {
        if (ReadHeader(path) is not { } bytes) return null;

        // IHDR data begins after 8 signature + 4 length + 4 type: width then height, big-endian.
        var width = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(16, 4));
        var height = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(20, 4));
        return ((int)width, (int)height);
    }

    /// <summary>The bytes, once the signature and a complete IHDR are known to be present.</summary>
    private static byte[]? ReadHeader(string path)
    {
        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(path);
        }
        catch (IOException)
        {
            return null;
        }

        if (bytes.Length <= ColourTypeOffset) return null;
        return bytes.AsSpan(0, Signature.Length).SequenceEqual(Signature) ? bytes : null;
    }

    /// <summary>
    /// Whether a chunk type appears in the stream. Walks the chunk list rather than searching the
    /// bytes, so a type name occurring inside compressed image data cannot be mistaken for a chunk.
    /// </summary>
    private static bool HasChunk(byte[] bytes, string type)
    {
        var name = System.Text.Encoding.ASCII.GetBytes(type);
        var at = Signature.Length;

        // 4 length + 4 type + 4 CRC is the fixed cost of a chunk; stop before reading past the end.
        while (at + 12 <= bytes.Length)
        {
            var length = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(at, 4));
            if (bytes.AsSpan(at + 4, 4).SequenceEqual(name)) return true;
            if (length > int.MaxValue) return false;
            at += 12 + (int)length;
        }

        return false;
    }
}
