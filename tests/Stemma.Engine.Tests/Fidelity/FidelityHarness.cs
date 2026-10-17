using System.Text;
using Stemma.Engine.Operations;
using Xunit.Sdk;

namespace Stemma.Engine.Tests.Fidelity;

/// <summary>
/// A fixture copied byte for byte into a throwaway model-only workspace, so every case starts from
/// exactly what is on disk and the engine writes back through the same path a user's edit takes.
/// </summary>
internal sealed class FixtureWorkspace : IAsyncDisposable
{
    public string RootPath { get; }
    public string ArchPath { get; }

    private FixtureWorkspace(string root, string archPath)
    {
        RootPath = root;
        ArchPath = archPath;
    }

    public static Task<FixtureWorkspace> CreateAsync(string fixture)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-fidelity-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        var archPath = Path.Combine(root, "Architecture", "Architecture.cs");
        File.Copy(FixturePath(fixture), archPath);
        return Task.FromResult(new FixtureWorkspace(root, archPath));
    }

    /// <summary>
    /// A type fixture as <c>Domain/Ordering.cs</c>, beside the smallest model that makes the folder a
    /// workspace. <see cref="ArchPath"/> is then the domain file, since that is what is under test.
    /// </summary>
    public static async Task<FixtureWorkspace> CreateForTypesAsync(string fixture)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-fidelity-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        Directory.CreateDirectory(Path.Combine(root, "Domain"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), """
            using Stemma.Model;

            namespace Fixture;

            public static class Architecture
            {
                public static Model Build() => Model.Of();
            }
            """);
        var domainPath = Path.Combine(root, "Domain", "Ordering.cs");
        File.Copy(FixturePath(fixture, "types"), domainPath);
        return new FixtureWorkspace(root, domainPath);
    }

    public static string FixturePath(string fixture, string kind = "arch") =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", kind, fixture + ".cs");

    public string ReadArch() => Fidelity.Decode(File.ReadAllBytes(ArchPath));

    public ValueTask DisposeAsync()
    {
        // A temp directory that outlives a failed run is harmless, and a cleanup failure must not
        // replace the assertion that actually failed.
        try { Directory.Delete(RootPath, recursive: true); } catch (IOException) { }
        return ValueTask.CompletedTask;
    }
}

internal static class Fidelity
{
    /// <summary>
    /// Decoded without stripping the byte-order mark, so a lost BOM is a difference like any other
    /// rather than something the comparison quietly forgives.
    /// </summary>
    public static string Decode(byte[] bytes) => new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetString(bytes);

    /// <summary>
    /// The text with exactly these edits made, each to a span that occurs once. Every expectation in
    /// the suite is written out by hand this way rather than computed, so it never shares a line of
    /// code with the writer it is checking.
    /// </summary>
    public static string Expect(string before, IEnumerable<(string From, string To)> edits)
    {
        var text = before;
        foreach (var (from, to) in edits)
        {
            var at = text.IndexOf(from, StringComparison.Ordinal);
            if (at < 0)
                throw new XunitException($"The case edits text the fixture does not contain: {Visible(from)}");
            if (text.IndexOf(from, at + 1, StringComparison.Ordinal) >= 0)
                throw new XunitException($"The case edits text that occurs more than once, so it is ambiguous: {Visible(from)}");
            text = string.Concat(text.AsSpan(0, at), to, text.AsSpan(at + from.Length));
        }
        return text;
    }

    public static void ShouldBeExactly(this string actual, string expected, string because)
    {
        if (actual == expected) return;
        throw new XunitException($"Expected the file to be exactly as described because {because}, but {FirstDifference(expected, actual)}");
    }

    public static void ShouldBeApplied(this OperationResult result)
    {
        if (result is OperationFailed f)
            throw new XunitException($"Expected the operation to apply, but it failed: {f.Reason}: {f.Message}" +
                (f.Diagnostics is { Count: > 0 } d ? $"\n  {string.Join("\n  ", d)}" : ""));
    }

    /// <summary>The first line that differs, with tabs, carriage returns and the BOM made visible.</summary>
    private static string FirstDifference(string expected, string actual)
    {
        var e = SplitKeepingEndings(expected);
        var a = SplitKeepingEndings(actual);
        for (var i = 0; i < Math.Max(e.Count, a.Count); i++)
        {
            var el = i < e.Count ? e[i] : null;
            var al = i < a.Count ? a[i] : null;
            if (el == al) continue;
            return $"line {i + 1} differs.\n  expected: {(el is null ? "<end of file>" : Visible(el))}\n  actual:   {(al is null ? "<end of file>" : Visible(al))}";
        }
        return "the two differ in a way no line shows.";
    }

    private static List<string> SplitKeepingEndings(string text)
    {
        var lines = new List<string>();
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] != '\n') continue;
            lines.Add(text[start..(i + 1)]);
            start = i + 1;
        }
        if (start < text.Length) lines.Add(text[start..]);
        return lines;
    }

    private static string Visible(string s) => "«" + s
        .Replace("﻿", "<BOM>")
        .Replace("\t", "→")
        .Replace("\r", "\\r")
        .Replace("\n", "\\n") + "»";
}
