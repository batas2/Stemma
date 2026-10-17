using System.Text;
using Stemma.Engine.Operations;

namespace Stemma.Engine.Workspace;

/// <summary>
/// A JSON file beside the model that the engine edits as text and watches: <c>stemma.layout.json</c>
/// and <c>comments.stemma.json</c> (ADR-0021). A change is made to the file as it is on disk now, a
/// file that cannot be read is refused rather than replaced, and a change on disk is told apart from
/// the echo of the engine's own write by content, never by the clock (B-008).
/// </summary>
internal sealed class SidecarFile(string path, string created)
{
    private static readonly byte[] Utf8Bom = [0xEF, 0xBB, 0xBF];

    private readonly SemaphoreSlim _gate = new(1, 1);
    // The file as this engine last wrote or announced it.
    private string? _seen;

    public bool Is(string other) =>
        string.Equals(Path.GetFullPath(other), Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase);

    /// <summary>Take the file as it is now for what has already been seen.</summary>
    public void Remember() => _seen = ReadText();

    /// <summary>Whether the file now differs from what this engine last wrote or announced.</summary>
    public async Task<bool> TakeInAsync()
    {
        await _gate.WaitAsync();
        try
        {
            var text = ReadText();
            if (text == _seen) return false;
            _seen = text;
            return true;
        }
        finally { _gate.Release(); }
    }

    /// <summary>
    /// <paramref name="apply"/> to the file as it is on disk, or to <c>created</c> when there is no
    /// file yet. Its byte-order mark, if it has one, is kept; a refusal writes nothing, and so does a
    /// change that changes nothing.
    /// </summary>
    public async Task<OperationResult> PatchAsync(string opId, Func<string, string> apply, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var exists = File.Exists(path);
            var bytes = exists ? await File.ReadAllBytesAsync(path, ct) : [];
            var bom = bytes.AsSpan().StartsWith(Utf8Bom);
            var text = exists ? Encoding.UTF8.GetString(bom ? bytes[Utf8Bom.Length..] : bytes) : created;

            string patched;
            try { patched = apply(text); }
            catch (SidecarPatchRefusedException e) { return new OperationFailed(opId, e.Reason, e.Message); }
            if (patched == text) return new OperationApplied(opId, []);

            _seen = patched;
            await File.WriteAllBytesAsync(path, [.. (bom ? Utf8Bom : []), .. Encoding.UTF8.GetBytes(patched)], ct);
            return new OperationApplied(opId, []);
        }
        finally { _gate.Release(); }
    }

    /// <summary>The file's text without its byte-order mark; <c>null</c> when there is no file.</summary>
    private string? ReadText()
    {
        if (!File.Exists(path)) return null;
        var bytes = File.ReadAllBytes(path);
        return Encoding.UTF8.GetString(bytes.AsSpan().StartsWith(Utf8Bom) ? bytes[Utf8Bom.Length..] : bytes);
    }
}
