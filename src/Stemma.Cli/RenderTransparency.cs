namespace Stemma.Cli;

/// <summary>
/// Reconciles what a render was asked for with what it produced.
///
/// Separate from <see cref="RenderCommand"/> because it is the part worth testing on its own: B-003
/// was a disagreement between the request and the artefact that nothing was looking for, and a check
/// buried in a command body is a check that only an end-to-end render can exercise.
/// </summary>
public static class RenderTransparency
{
    /// <summary>
    /// What the written PNGs actually are. Null when only SVG was written, or when no file could be
    /// read back — an absent value says "not established", which is honest, where `false` would be a
    /// second untrue claim.
    /// </summary>
    public static bool? Of(IReadOnlyList<RenderedFile> files)
    {
        var known = files.Select(f => f.HasAlpha).OfType<bool>().ToList();
        if (known.Count == 0) return null;
        return known.All(a => a);
    }

    /// <summary>
    /// Refuse to report success when the artefact contradicts the request.
    ///
    /// B-003 shipped six opaque PNGs behind a `transparent: true` manifest and an exit code of zero.
    /// Recording the truth in the manifest fixes the record; this is what stops the wrong file from
    /// being published in the first place, which is the failure the caller actually cares about.
    /// </summary>
    public static string? Mismatch(bool requested, IReadOnlyList<RenderedFile> files)
    {
        var wrong = files.FirstOrDefault(f => f.HasAlpha is bool actual && actual != requested);
        if (wrong is null) return null;

        return requested
            ? $"{Path.GetFileName(wrong.Path)} was written without an alpha channel, but a transparent render was asked for. " +
              "Something in the page is painting the backdrop; pass --opaque if a baked background is what you want."
            : $"{Path.GetFileName(wrong.Path)} was written with an alpha channel despite --opaque.";
    }
}
