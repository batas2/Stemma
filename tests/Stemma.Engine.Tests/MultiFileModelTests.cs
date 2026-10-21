using FluentAssertions;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// A model split over several files under <c>Architecture/</c> is one model. Every operation that
/// looks something up — an element to link to, an id that is free — has to look across all of them,
/// and the model it reads has to be assembled by the same rule whether it is read live or as it was
/// at a past revision.
/// </summary>
public sealed class MultiFileModelTests
{
    private const string Primary = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var ctx = new BoundedContext("ctx_001", "Ordering");
                var modA = new Module("mod_a", "A");

                return Model.Of(ctx, modA);
            }
        }

        """;

    private const string Payments = """
        using Stemma.Model;

        namespace Scratch;

        public static class PaymentsArchitecture
        {
            public static Model Build()
            {
                var modPay = new Module("mod_pay", "Pay");
                var flow = new DataFlow("flow_001", "mod_pay", "ctx_001", "Money");

                return Model.Of(modPay, flow);
            }
        }

        """;

    private static async Task<string> CreateAsync(params (string Name, string Text)[] files)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-multi-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        foreach (var (name, text) in files)
            await File.WriteAllTextAsync(Path.Combine(root, "Architecture", name), text);
        return root;
    }

    private static void Applied(OperationResult r)
    {
        if (r is OperationFailed f) throw new Xunit.Sdk.XunitException($"{f.Reason}: {f.Message}");
    }

    [Fact]
    public async Task A_model_in_one_file_drops_a_duplicate_id_as_the_history_read_does()
    {
        // The read of a past revision always merged, the live one only when there were two files: a
        // model declaring an id twice compared with itself showed a change that was not there.
        var root = await CreateAsync(("Architecture.cs", Primary.Replace(
            "        var modA = new Module(\"mod_a\", \"A\");\n",
            "        var modA = new Module(\"mod_a\", \"A\");\n        var modAgain = new Module(\"mod_a\", \"A again\");\n")
            .Replace("Model.Of(ctx, modA)", "Model.Of(ctx, modA, modAgain)")));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var live = (await engine.ReadArchModelAsync())!;

            live.Elements.Where(e => e.Id == "mod_a").Should().ContainSingle().Which.Name.Should().Be("A",
                "the first declaration of an id is the one that counts, in every read");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
