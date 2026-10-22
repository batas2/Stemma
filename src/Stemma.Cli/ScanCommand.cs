using System.Text.Json;
using Stemma.Engine.Conformance;

namespace Stemma.Cli;

/// <summary>
/// `stemma scan` — the .NET projects under a path and what each references (F-025 AC4, ADR-0029).
///
/// An agent asked to describe the system that exists has to start from something it did not make up.
/// This is that something: the graph conformance compares the model with, as facts — each project's
/// name, path, SDK, output type and target frameworks, and its project references, a reference out of
/// the tree kept and marked external. Projects are evidence, not architecture; grouping them into the
/// containers a person would name, and writing the <c>Code.Map</c> that ties each to its projects, is
/// the agent's and the architect's work.
/// </summary>
public static class ScanCommand
{
    public const string Usage = """
        stemma scan — the .NET projects under a path, and what each references.

          stemma scan [<path>] [--json]

        Lists every .csproj under the path — never in bin, obj, node_modules or a dot-folder — with its
        name, path, SDK, output type and target frameworks, and its project references. A reference to
        a project outside the path is listed and marked external. Project files are read as XML: no
        build, no SDK, conditions and imports not followed.

        It is the material for a model of the system that exists, and for the Code.Map in Rules/ that
        ties each container to its projects, so validate can compare the two.

        Options
          <path>               Where to look. Defaults to the current directory.
          --json               Machine-readable output.

        Exit codes
          0  scanned (even when there are no projects)
          2  the command line was wrong, or the path does not exist
          3  the scan could not run (a folder it could not read, say)
        """;

    public static Task<int> RunAsync(string[] args)
    {
        if (args.Contains("--help") || args.Contains("-h"))
        {
            Console.WriteLine(Usage);
            return Task.FromResult(0);
        }

        string? positional = null;
        var json = false;
        foreach (var arg in args)
        {
            if (arg == "--json") json = true;
            else if (arg.StartsWith('-')) return Fail($"unknown option '{arg}'");
            else if (positional is not null) return Fail($"unexpected argument '{arg}' — scan looks under one path");
            else positional = arg;
        }

        var root = Path.GetFullPath(positional ?? Directory.GetCurrentDirectory());
        if (!Directory.Exists(root))
        {
            Console.Error.WriteLine($"stemma scan: no such folder '{root}'");
            return Task.FromResult(2);
        }

        ProjectGraph graph;
        try
        {
            graph = ProjectGraph.Read(root);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"stemma scan: could not read '{root}': {e.Message}");
            return Task.FromResult(3);
        }

        if (json) WriteJson(graph);
        else WriteText(graph);
        return Task.FromResult(0);
    }

    private static string Shown(ProjectGraph graph, string path) => Path.GetRelativePath(graph.Root, path).Replace('\\', '/');

    private static void WriteJson(ProjectGraph graph)
    {
        var byPath = graph.Projects.ToDictionary(p => p.Path, ProjectGraph.PathComparer);
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            root = graph.Root,
            projects = graph.Projects.Select(p => new
            {
                name = p.Name,
                path = Shown(graph, p.Path),
                sdk = p.Sdk,
                outputType = p.OutputType,
                targetFrameworks = p.TargetFrameworks,
                references = p.References.Select(r => new
                {
                    name = byPath.TryGetValue(r.Path, out var target) ? target.Name : Path.GetFileNameWithoutExtension(r.Path),
                    path = Shown(graph, r.Path),
                    external = r.External,
                }),
                problem = p.Problem,
            }),
        }, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static void WriteText(ProjectGraph graph)
    {
        if (graph.Projects.Count == 0)
        {
            Console.WriteLine($"stemma scan: no projects under {graph.Root}");
            return;
        }
        Console.WriteLine($"stemma scan: {graph.Projects.Count} project(s) under {graph.Root}");
        var width = graph.Projects.Max(p => p.Name.Length);
        foreach (var project in graph.Projects)
        {
            Console.WriteLine();
            var frameworks = project.TargetFrameworks.Count == 0 ? "(no target framework)" : string.Join(";", project.TargetFrameworks);
            Console.WriteLine($"  {project.Name.PadRight(width)}  {project.OutputType,-8} {frameworks,-16} {Shown(graph, project.Path)}");
            if (project.Problem is not null) Console.WriteLine($"    ! {project.Problem}");
            foreach (var reference in project.References)
                Console.WriteLine($"    -> {Path.GetFileNameWithoutExtension(reference.Path)}{(reference.External ? $"  (external: {Shown(graph, reference.Path)})" : "")}");
        }
    }

    private static Task<int> Fail(string message)
    {
        Console.Error.WriteLine($"stemma scan: {message}");
        Console.Error.WriteLine();
        Console.Error.WriteLine(Usage);
        return Task.FromResult(2);
    }
}
