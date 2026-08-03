using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace Stemma.Web.Services;

/// <summary>
/// Creates a new, empty model on disk. Deliberately a <em>model-only</em> workspace: no project file,
/// so it opens with no .NET SDK, no restore and no design-time build writing obj/ into the user's
/// brand-new folder (ADR-0016).
/// </summary>
public static class WorkspaceScaffold
{
    /// <summary>Where models go when the user just gives a name.</summary>
    public static string DefaultRoot =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "stemma");

    public static string PathFor(string name) => Path.Combine(DefaultRoot, Slug(name));

    public sealed record Result(string RootPath, bool GitInitialised, string? GitError);

    public static async Task<Result> CreateAsync(string name, string? rootPath, CancellationToken ct = default)
    {
        var resolved = string.IsNullOrWhiteSpace(rootPath) ? PathFor(name) : Path.GetFullPath(rootPath);
        var identifier = Identifier(name);

        Directory.CreateDirectory(resolved);
        Directory.CreateDirectory(Path.Combine(resolved, "Architecture"));

        await WriteIfMissingAsync(Path.Combine(resolved, "Architecture", "Architecture.cs"),
            $$"""
              using Stemma.Model;

              namespace {{identifier}};

              /// <summary>
              /// The architecture model. This file is the database — Stemma edits it in place, and
              /// every change it makes is a normal Git diff you can read and review.
              /// </summary>
              public static class Architecture
              {
                  public static Model Build()
                  {
                      return Model.Of();
                  }
              }

              """, ct);

        // Without this the first load drops build output into a folder the user just created. It also
        // matters if they later add a project file and move onto the MSBuild path.
        await WriteIfMissingAsync(Path.Combine(resolved, ".gitignore"),
            """
            # build output
            obj/
            bin/

            # editor noise
            .vs/
            .idea/
            *.user

            """, ct);

        await WriteIfMissingAsync(Path.Combine(resolved, "README.md"),
            $"""
             # {name}

             An architecture model maintained with [Stemma](https://github.com/batas2/Stemma).

             - `Architecture/Architecture.cs` — the model itself. This is the source of truth.
             - `Views/` — saved views, once you create them.
             - `stemma.layout.json` — positions and styling. Presentation only; safe to diff.

             Open this folder in Stemma, or edit the C# directly — both work, and both round-trip.

             """, ct);

        var (initialised, error) = await TryGitInitAsync(resolved, ct);
        return new Result(resolved, initialised, error);
    }

    private static async Task WriteIfMissingAsync(string path, string content, CancellationToken ct)
    {
        if (File.Exists(path)) return;
        // UTF-8 without a BOM: what the C# tooling produces, and what keeps first diffs clean.
        await File.WriteAllTextAsync(path, content, new UTF8Encoding(false), ct);
    }

    /// <summary>
    /// Git-native is the pitch, so a new model starts as a repository with one commit. Best-effort:
    /// a machine without git still gets a working model, just not a repo.
    /// </summary>
    private static async Task<(bool, string?)> TryGitInitAsync(string root, CancellationToken ct)
    {
        if (Directory.Exists(Path.Combine(root, ".git"))) return (true, null);
        try
        {
            var init = await RunGitAsync(root, ct, "init", "--quiet");
            if (init is not null) return (false, init);

            var add = await RunGitAsync(root, ct, "add", ".");
            if (add is not null) return (false, add);

            var commit = await RunGitAsync(root, ct, "commit", "--quiet", "-m", "Start architecture model");
            // An empty or failed commit (no identity configured, say) still leaves a usable repo.
            return (true, commit);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    private static async Task<string?> RunGitAsync(string workingDir, CancellationToken ct, params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = workingDir,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var proc = Process.Start(psi);
        if (proc is null) return "git is not available on PATH";
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return proc.ExitCode == 0 ? null : stderr.Trim();
    }

    /// <summary>Folder-safe form of the model name.</summary>
    public static string Slug(string name)
    {
        var cleaned = Regex.Replace(name.Trim(), @"[^\w\-. ]", "").Replace(' ', '-');
        cleaned = Regex.Replace(cleaned, "-{2,}", "-").Trim('-', '.');
        return cleaned.Length == 0 ? "model" : cleaned;
    }

    /// <summary>C# namespace-safe form of the model name.</summary>
    public static string Identifier(string name)
    {
        var parts = Regex.Split(name.Trim(), @"[^\w]+")
            .Where(p => p.Length > 0)
            .Select(p => char.IsDigit(p[0]) ? "_" + p : char.ToUpperInvariant(p[0]) + p[1..]);
        var joined = string.Concat(parts);
        return joined.Length == 0 ? "Model" : joined;
    }
}
