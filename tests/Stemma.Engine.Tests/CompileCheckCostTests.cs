using FluentAssertions;
using Microsoft.Extensions.Logging;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// Every edit is compiled to see whether it broke the build. That check compiled every project in the
/// workspace twice — once for the errors already there, once for the errors after — whatever the edit
/// touched, so a rename in the model paid for every other project in the repository, twice. The
/// errors after one edit are the errors before the next, and a project an edit cannot reach cannot
/// have gained any.
/// </summary>
public sealed class CompileCheckCostTests
{
    private const int CompileChecked = 1104;

    private static (ILogger<StemmaEngine> Logger, RecordingLoggerProvider Provider) Recording()
    {
        var provider = new RecordingLoggerProvider(LogLevel.Trace);
        var factory = LoggerFactory.Create(b => { b.SetMinimumLevel(LogLevel.Trace); b.AddProvider(provider); });
        return (factory.CreateLogger<StemmaEngine>(), provider);
    }

    private static int ChecksOf(RecordingLoggerProvider provider, string project) =>
        provider.Records.Count(r => r.EventId.Id == CompileChecked && r.Message.Contains($" {project} "));

    private const string Model = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var a = new Module("mod_a", "A");
                return Model.Of(a);
            }
        }
        """;

    [Fact]
    public async Task An_edit_compiles_its_project_once_not_twice()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-check-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), Model);
        var (logger, provider) = Recording();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root, default, logger);
            var project = engine.Solution.Projects.Single().Name;
            (await engine.ApplyAsync(new RenameElementOp("op1", "mod_a", "Alpha"))).Should().BeOfType<Operations.OperationApplied>();
            var before = ChecksOf(provider, project);

            (await engine.ApplyAsync(new RenameElementOp("op2", "mod_a", "Beta"))).Should().BeOfType<Operations.OperationApplied>();

            ChecksOf(provider, project).Should().Be(before + 1, "the errors before this edit are the ones the last edit left");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_edit_never_compiles_a_project_it_cannot_reach()
    {
        var modelProj = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Stemma.Model", "Stemma.Model.csproj"));
        var root = Path.Combine(Path.GetTempPath(), $"stemma-check-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Arch", "Architecture"));
        Directory.CreateDirectory(Path.Combine(root, "Billing"));
        await File.WriteAllTextAsync(Path.Combine(root, "Arch", "Arch.csproj"), $"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup>
              <ItemGroup><ProjectReference Include="{modelProj}" /></ItemGroup>
            </Project>
            """);
        await File.WriteAllTextAsync(Path.Combine(root, "Arch", "Architecture", "Architecture.cs"), Model);
        await File.WriteAllTextAsync(Path.Combine(root, "Billing", "Billing.csproj"), """
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup>
            </Project>
            """);
        await File.WriteAllTextAsync(Path.Combine(root, "Billing", "Invoice.cs"), "namespace Billing;\n\npublic class Invoice\n{\n}\n");
        var (logger, provider) = Recording();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root, default, logger);
            (await engine.ApplyAsync(new RenameElementOp("op1", "mod_a", "Alpha"))).Should().BeOfType<Operations.OperationApplied>();
            (await engine.ApplyAsync(new RenameElementOp("op2", "mod_a", "Beta"))).Should().BeOfType<Operations.OperationApplied>();

            ChecksOf(provider, "Arch").Should().BeGreaterThan(0, "the project the edit changed is checked");
            ChecksOf(provider, "Billing").Should().BeLessThanOrEqualTo(1,
                "nothing in Billing depends on the model; at most it is compiled once, ahead of any edit");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
