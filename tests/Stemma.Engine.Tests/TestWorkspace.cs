namespace Stemma.Engine.Tests;

public sealed class TestWorkspace : IAsyncDisposable
{
    public string RootPath { get; }
    public string ProjectFile { get; }

    private TestWorkspace(string root, string proj)
    {
        RootPath = root;
        ProjectFile = proj;
    }

    public static async Task<TestWorkspace> CreateAsync(Dictionary<string, string> files)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var projDir = Path.Combine(root, "Sample");
        Directory.CreateDirectory(projDir);
        var projPath = Path.Combine(projDir, "Sample.csproj");
        await File.WriteAllTextAsync(projPath, """
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <TargetFramework>net10.0</TargetFramework>
            <Nullable>enable</Nullable>
            <ImplicitUsings>enable</ImplicitUsings>
            <LangVersion>latest</LangVersion>
          </PropertyGroup>
        </Project>
        """);
        foreach (var (rel, content) in files)
        {
            var path = Path.Combine(projDir, rel);
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            await File.WriteAllTextAsync(path, content);
        }
        return new TestWorkspace(root, projPath);
    }

    public string ReadFile(string relativeFromProject) =>
        File.ReadAllText(Path.Combine(Path.GetDirectoryName(ProjectFile)!, relativeFromProject));

    public ValueTask DisposeAsync()
    {
        try { Directory.Delete(RootPath, recursive: true); } catch { }
        return ValueTask.CompletedTask;
    }
}
