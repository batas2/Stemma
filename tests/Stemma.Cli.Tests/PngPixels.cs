using System.IO.Compression;

namespace Stemma.Cli.Tests;

/// <summary>
/// Just enough PNG decoding to ask what colour a pixel is: 8-bit RGB or RGBA, not interlaced — what a
/// browser screenshot writes. A test that asserts on what the image shows needs this and nothing more.
/// </summary>
internal sealed class PngPixels
{
    public int Width { get; }
    public int Height { get; }
    private readonly byte[] _rows; // unfiltered, `Height` rows of `Width * _bpp` bytes
    private readonly int _bpp;

    private PngPixels(int width, int height, int bpp, byte[] rows) { Width = width; Height = height; _bpp = bpp; _rows = rows; }

    public (byte R, byte G, byte B, byte A) At(int x, int y)
    {
        var i = (y * Width + x) * _bpp;
        return (_rows[i], _rows[i + 1], _rows[i + 2], _bpp == 4 ? _rows[i + 3] : (byte)255);
    }

    public static PngPixels Read(string path)
    {
        var bytes = File.ReadAllBytes(path);
        int width = 0, height = 0, colourType = 0;
        using var idat = new MemoryStream();
        for (var at = 8; at < bytes.Length;)
        {
            var length = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
            var type = System.Text.Encoding.ASCII.GetString(bytes, at + 4, 4);
            var data = at + 8;
            if (type == "IHDR")
            {
                width = (bytes[data] << 24) | (bytes[data + 1] << 16) | (bytes[data + 2] << 8) | bytes[data + 3];
                height = (bytes[data + 4] << 24) | (bytes[data + 5] << 16) | (bytes[data + 6] << 8) | bytes[data + 7];
                if (bytes[data + 8] != 8 || bytes[data + 12] != 0) throw new NotSupportedException("only 8-bit, non-interlaced PNGs");
                colourType = bytes[data + 9];
            }
            else if (type == "IDAT") idat.Write(bytes, data, length);
            else if (type == "IEND") break;
            at = data + length + 4;
        }
        var bpp = colourType switch { 2 => 3, 6 => 4, _ => throw new NotSupportedException($"colour type {colourType}") };

        idat.Position = 0;
        using var z = new ZLibStream(idat, CompressionMode.Decompress);
        using var raw = new MemoryStream();
        z.CopyTo(raw);
        var src = raw.ToArray();

        var stride = width * bpp;
        var rows = new byte[height * stride];
        for (var y = 0; y < height; y++)
        {
            var filter = src[y * (stride + 1)];
            var line = y * (stride + 1) + 1;
            for (var x = 0; x < stride; x++)
            {
                int a = x >= bpp ? rows[y * stride + x - bpp] : 0;
                int b = y > 0 ? rows[(y - 1) * stride + x] : 0;
                int c = x >= bpp && y > 0 ? rows[(y - 1) * stride + x - bpp] : 0;
                int v = src[line + x];
                rows[y * stride + x] = (byte)(filter switch
                {
                    0 => v,
                    1 => v + a,
                    2 => v + b,
                    3 => v + ((a + b) >> 1),
                    4 => v + Paeth(a, b, c),
                    _ => throw new NotSupportedException($"filter {filter}"),
                });
            }
        }
        return new PngPixels(width, height, bpp, rows);
    }

    private static int Paeth(int a, int b, int c)
    {
        var p = a + b - c;
        int pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
}
