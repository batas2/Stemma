using System.Security.Cryptography;
using System.Text;

namespace Stemma.Engine.Diagnostics;

/// <summary>
/// Short content hashes, so a rewrite can be described without quoting the source.
///
/// This is what makes the fidelity guarantee observable between test runs. A pair of hashes on every
/// document write proves after the fact which operation touched which file and whether it changed at
/// all — for the cost of one hash — without putting the user's C# in a log record that might later be
/// pasted into an issue.
///
/// Twelve hex characters: enough that a collision is not a practical concern for the handful of
/// documents in one workspace, short enough to read in a terminal and compare by eye.
/// </summary>
public static class ContentHash
{
    public const int Length = 12;

    /// <summary>A short, stable hash of the text. `null` and empty hash to distinct constants, so a
    /// missing document and an empty one are not confused in a log.</summary>
    public static string Of(string? text)
    {
        if (text is null) return "(none)";
        if (text.Length == 0) return "(empty)";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(text));
        return Convert.ToHexStringLower(bytes)[..Length];
    }

    /// <summary>
    /// A minimal unified diff, for the `Trace` record only.
    ///
    /// Deliberately line-based and unclever: this exists so a fidelity bug can be reconstructed from
    /// a log without the reporter's source, not to be a diff library. Context is trimmed to a few
    /// lines around each change because an untrimmed diff of a large document is a record nobody
    /// reads and everybody pays to produce.
    /// </summary>
    public static string UnifiedDiff(string? before, string? after, int context = 2, int maxLines = 200)
    {
        var a = (before ?? string.Empty).ReplaceLineEndings("\n").Split('\n');
        var b = (after ?? string.Empty).ReplaceLineEndings("\n").Split('\n');

        // Common prefix and suffix, which is almost the whole document for a well-behaved rewrite.
        var start = 0;
        while (start < a.Length && start < b.Length && a[start] == b[start]) start++;

        var endA = a.Length - 1;
        var endB = b.Length - 1;
        while (endA >= start && endB >= start && a[endA] == b[endB]) { endA--; endB--; }

        if (start > endA && start > endB) return "(identical)";

        var sb = new StringBuilder();
        var from = Math.Max(0, start - context);
        var toA = Math.Min(a.Length - 1, endA + context);
        var toB = Math.Min(b.Length - 1, endB + context);

        sb.Append("@@ -").Append(from + 1).Append(',').Append(toA - from + 1)
          .Append(" +").Append(from + 1).Append(',').Append(toB - from + 1).Append(" @@\n");

        var written = 0;
        for (var i = from; i < start && written < maxLines; i++, written++) sb.Append("  ").Append(a[i]).Append('\n');
        for (var i = start; i <= endA && written < maxLines; i++, written++) sb.Append("- ").Append(a[i]).Append('\n');
        for (var i = start; i <= endB && written < maxLines; i++, written++) sb.Append("+ ").Append(b[i]).Append('\n');
        for (var i = endA + 1; i <= toA && written < maxLines; i++, written++) sb.Append("  ").Append(a[i]).Append('\n');

        if (written >= maxLines) sb.Append("… diff truncated at ").Append(maxLines).Append(" lines\n");
        return sb.ToString();
    }
}
