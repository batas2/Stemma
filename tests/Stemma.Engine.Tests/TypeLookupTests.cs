using FluentAssertions;
using Stemma.Engine.Models;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// A type operation names its type by full name, and edits that type. It used to look for the first
/// declaration in the file with the same simple name, so with an <c>Item</c> in two namespaces of one
/// file, removing <c>Billing.Item</c> removed <c>Catalog.Item</c>.
/// </summary>
public sealed class TypeLookupTests
{
    private const string TwoItems = """
        namespace Catalog
        {
            public class Item
            {
                public string Sku { get; set; } = "";
            }
        }

        namespace Billing
        {
            public class Item
            {
                public decimal Amount { get; set; }
            }
        }

        """;

    private static async Task<(string Root, string File)> CreateAsync(string domain)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-types-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        Directory.CreateDirectory(Path.Combine(root, "Domain"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"),
            "using Stemma.Model;\n\nnamespace Scratch;\n\npublic static class Architecture\n{\n    public static Model Build() => Model.Of();\n}\n");
        var file = Path.Combine(root, "Domain", "Items.cs");
        await File.WriteAllTextAsync(file, domain);
        return (root, file);
    }

    [Fact]
    public async Task Removing_a_type_removes_the_one_its_full_name_names()
    {
        var (root, file) = await CreateAsync(TwoItems);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            (await engine.ApplyAsync(new RemoveTypeOp("op", "Billing.Item"))).Should().BeOfType<OperationApplied>();

            var after = await File.ReadAllTextAsync(file);
            after.Should().Contain("public string Sku").And.NotContain("public decimal Amount");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_property_goes_to_the_type_its_full_name_names()
    {
        var (root, file) = await CreateAsync(TwoItems);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            (await engine.ApplyAsync(new AddPropertyOp("op", "Billing.Item", "Currency", "string", Visibility.Public, true, true, false)))
                .Should().BeOfType<OperationApplied>();

            (await File.ReadAllTextAsync(file)).Should().Be(TwoItems.Replace(
                "        public decimal Amount { get; set; }\n",
                "        public decimal Amount { get; set; }\n        public string Currency { get; set; }\n"));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_full_name_two_declarations_share_is_refused_rather_than_guessed()
    {
        // The model names a nested type by its namespace and its own name, so Ordering.Line is both the
        // top-level Line and the one inside Order. Which one was meant cannot be told.
        const string source = """
            namespace Ordering;

            public class Line
            {
                public int Quantity { get; set; }
            }

            public class Order
            {
                public class Line
                {
                    public string Note { get; set; } = "";
                }
            }

            """;
        var (root, file) = await CreateAsync(source);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);

            var result = await engine.ApplyAsync(new RemoveTypeOp("op", "Ordering.Line"));

            result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("AmbiguousType");
            (await File.ReadAllTextAsync(file)).Should().Be(source);
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
