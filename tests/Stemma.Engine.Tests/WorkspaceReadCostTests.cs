using FluentAssertions;
using Microsoft.Extensions.Logging;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// What each operation costs before it writes anything. The model was read from every model file
/// before every operation, and again inside most of them; finding a declaration walked every node of
/// every model file; each edit rebuilt the type model of every document in the workspace; and the
/// first edit after opening waited a second for the compilation to be built. None of that changes
/// while the files do not.
/// </summary>
public sealed class WorkspaceReadCostTests
{
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

    private static async Task<string> CreateAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-reads-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        Directory.CreateDirectory(Path.Combine(root, "Domain"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), Model);
        await File.WriteAllTextAsync(Path.Combine(root, "Domain", "Invoice.cs"), "namespace Domain;\n\npublic class Invoice\n{\n    public decimal Total { get; set; }\n}\n");
        return root;
    }

    [Fact]
    public async Task The_model_is_read_once_until_a_file_changes()
    {
        var root = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            var first = await engine.ReadArchModelAsync();
            (await engine.ReadArchModelAsync()).Should().BeSameAs(first, "nothing changed in between");
            engine.FindArchitectureDocuments().Should().BeSameAs(engine.FindArchitectureDocuments());

            (await engine.ApplyAsync(new RenameElementOp("op", "mod_a", "Alpha"))).Should().BeOfType<OperationApplied>();

            var after = await engine.ReadArchModelAsync();
            after.Should().NotBeSameAs(first);
            after!.Elements.Single().Name.Should().Be("Alpha");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_edit_to_the_model_does_not_read_the_other_documents_types_again()
    {
        var root = await CreateAsync();
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var invoice = engine.Model.FindType("Domain.Invoice");

            (await engine.ApplyAsync(new RenameElementOp("op", "mod_a", "Alpha"))).Should().BeOfType<OperationApplied>();

            engine.Model.FindType("Domain.Invoice").Should().BeSameAs(invoice, "Invoice.cs did not change");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_watched_workspace_compiles_ahead_of_its_first_edit()
    {
        var root = await CreateAsync();
        var provider = new RecordingLoggerProvider(LogLevel.Trace);
        var logger = LoggerFactory.Create(b => { b.SetMinimumLevel(LogLevel.Trace); b.AddProvider(provider); }).CreateLogger<StemmaEngine>();
        int Checks() => provider.Records.Count(r => r.EventId.Id == 1104);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root, default, logger);
            engine.StartWatching();

            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
            while (Checks() == 0 && DateTime.UtcNow < deadline) await Task.Delay(50);
            Checks().Should().Be(1, "the compilation is built in the background, before anyone edits");

            (await engine.ApplyAsync(new RenameElementOp("op", "mod_a", "Alpha"))).Should().BeOfType<OperationApplied>();

            Checks().Should().Be(2, "the first edit compiles only what it wrote");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
