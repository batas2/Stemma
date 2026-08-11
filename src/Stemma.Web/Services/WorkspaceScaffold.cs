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

             See [`STEMMA.md`](./STEMMA.md) before editing these files by hand.

             """, ct);

        await WriteIfMissingAsync(Path.Combine(resolved, "STEMMA.md"), Brief(name), ct);

        var (initialised, error) = await TryGitInitAsync(resolved, ct);
        return new Result(resolved, initialised, error);
    }

    /// <summary>
    /// The agent-facing brief (F-007 AC6). A workspace created by Stemma is very often edited by
    /// something that will never open the canvas — an agent with a shell, or a person writing the
    /// files directly — and the rules that matter are the ones neither the compiler nor the type
    /// system enforces. Those go here, at the root, where a reader lands. The full reference is in
    /// the Stemma repository; this is what has to be true before reading it is worth the trouble.
    /// </summary>
    internal static string Brief(string name) =>
        $$"""
          # Working on this model

          A brief for whoever edits these files by hand — including an agent that will never see the
          canvas. The full reference is `.doc/protocol/authoring-a-diagram.md` in the Stemma
          repository; everything below is the part you cannot get wrong.

          **`Architecture/Architecture.cs` says what exists. `Views/<Name>.cs` says what one picture
          is about. `stemma.layout.json` says how it is arranged.** Nothing else is required — this
          workspace has no project file and opens without the .NET SDK.

          ## The model

          One `public static Model Build()`, read off the syntax tree by name: one `var` per element,
          one per link, all collected into `Model.Of(...)`.

          ```csharp
          var api = new Container("cnt_api", "Booking API", "sys_platform", "service");
          var store = new Container("cnt_store", "Booking Store", "sys_platform", "db");
          var persist = new DataFlow("flow_persist", "cnt_api", "cnt_store", "order");

          return Model.Of(api, store, persist);
          ```

          Elements: `Person`, `SoftwareSystem`, `Container`, `BoundedContext`, `Module`,
          `Capability`, `UseCase`, `Question`, `Assumption`, `Risk`, and `Concept`. Links:
          `DataFlow`, `Dependency`, `Relation`.

          `Concept` is the one to understand first. Every other kind claims something — "this is a
          bounded context", "this is deployable". A box in an argument claims nothing, and forcing it
          into `Module` writes a falsehood into a file other people will copy from.

          ## The rules nothing enforces

          Ids are strings. A typo produces a missing node or a missing edge, silently, which is
          invisible to anyone who cannot look at the result.

          - Ids must be unique.
          - Every `fromId`, `toId`, `contextId`, `systemId` and `aboutId` must name a real element.
          - Prefixes keep them readable: `per_`, `sys_`, `cnt_`, `ctx_`, `mod_`, `cap_`, `uc_`,
            `q_`, `asm_`, `risk_`, `con_`, and `flow_` / `dep_` / `rel_` for links.
          - **A link is drawn only when both of its endpoints are in the view.** This is the usual
            reason a diagram comes out looking right and missing an arrow.
          - **Seven boxes is the working maximum.** Past that a picture has generally stopped
            answering one question.
          - **Never add an element to make a picture work.** That is what a free-form shape in the
            sidecar is for. An element is a claim about the system and it outlives the diagram.

          ## Checking and rendering

          ```
          stemma validate --workspace .            # what is broken; --json to act on it
          stemma render --workspace . --view <id> --out diagram.png
          ```

          `validate` is the answer to every "did I get the ids right" question. Run it before you
          look at anything. `render` produces the image with no browser open, and writes a manifest
          beside it so `render --check` can later tell you the picture has stopped matching
          `{{name}}`.

          """;

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
