using FluentAssertions;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// What the reader takes from an Architecture.cs, for the ways people actually write one. The
/// fidelity suite holds the writer to the file; these hold the reader to it — a declaration the
/// reader misses is a box missing from the canvas, and nothing says why.
/// </summary>
public sealed class DslReaderTests
{
    private static ArchModel.ArchModel? Read(string source) =>
        DslReader.TryRead("/tmp/Architecture.cs", CSharpSyntaxTree.ParseText(source).GetRoot());

    [Fact]
    public void The_model_is_read_from_the_static_build_that_returns_a_model_not_from_a_helper_above_it()
    {
        // A helper with a Build() of its own, declared first, was taken for the model: the canvas
        // showed nothing, and an edit would have landed in the helper's method body.
        var model = Read("""
            using Stemma.Model;
            public static class Helpers { public static object Build() { var x = new Module("mod_h", "Helper"); return x; } }
            public class Builder { public Model Build() { var y = new Module("mod_i", "Instance"); return Model.Of(y); } }
            public static class Architecture
            {
                public static Model Build()
                {
                    var a = new Module("mod_a", "A");
                    return Model.Of(a);
                }
            }
            """);

        model.Should().NotBeNull();
        model!.Elements.Select(e => e.Id).Should().Equal("mod_a");
    }

    [Fact]
    public void The_class_named_Architecture_is_preferred_over_another_model_builder_in_the_same_file()
    {
        var model = Read("""
            using Stemma.Model;
            public static class Scratch { public static Model Build() { var s = new Module("mod_s", "Scratch"); return Model.Of(s); } }
            public static class Architecture { public static Stemma.Model.Model Build() { var a = new Module("mod_a", "A"); return Model.Of(a); } }
            """);

        model!.Elements.Select(e => e.Id).Should().Equal("mod_a");
    }

    [Fact]
    public void A_file_whose_only_build_is_not_a_model_builder_has_no_model()
    {
        Read("""
            public static class Helpers { public static object Build() { return null; } }
            """).Should().BeNull();
    }
}
