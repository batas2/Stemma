using FluentAssertions;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// Reading back the line of C# that declares an id (F-003 AC7).
///
/// The product's whole claim is that the box on the canvas *is* the code, and the cheapest place to
/// demonstrate it is the first element someone adds. That demonstration is only worth anything if
/// what it shows is the file's own text — a reconstruction from the model would render correctly,
/// stay convincing, and quietly stop being evidence. So these tests are mostly about the snippet
/// being the source rather than a rendering of it.
/// </summary>
public class DslDeclarationTests
{
    private static DslDeclaration? Find(string buildBody, string id)
    {
        var source = $$"""
            using Stemma.Model;

            namespace Scratch;

            public static class Architecture
            {
                public static Model Build()
                {
            {{buildBody}}
                }
            }
            """;
        var root = CSharpSyntaxTree.ParseText(source).GetRoot();
        return DslReader.FindDeclaration("/tmp/Architecture.cs", root, id);
    }

    [Fact]
    public void Finds_an_element_and_quotes_it_verbatim()
    {
        var found = Find("""
                    var ctx = new BoundedContext("ctx_orders", "Ordering");
            """, "ctx_orders");

        found.Should().NotBeNull();
        found!.Text.Should().Be("""var ctx = new BoundedContext("ctx_orders", "Ordering");""");
    }

    [Fact]
    public void Keeps_the_author_s_own_spacing_inside_the_statement()
    {
        // Not normalised, not re-rendered. If the file has it, the snippet has it — the same
        // discipline the rewrites themselves are held to.
        var found = Find("""
                    var api = new Container( "cnt_api",  "Booking API", "sys_platform", "service" );
            """, "cnt_api");

        found!.Text.Should().Be("""var api = new Container( "cnt_api",  "Booking API", "sys_platform", "service" );""");
    }

    [Fact]
    public void Reports_the_line_an_editor_would_show()
    {
        var found = Find("""
                    var first = new Module("mod_a", "A");
                    var second = new Module("mod_b", "B");
            """, "mod_b");

        // 1-based, so it lines up with what an editor's gutter says. The preamble above the body is
        // eight lines (using, blank, namespace, blank, class, brace, signature, brace), which puts
        // the first declaration on 9 and this one on 10.
        found!.Line.Should().Be(10);
    }

    [Fact]
    public void Finds_a_link_as_well_as_an_element()
    {
        var found = Find("""
                    var a = new Module("mod_a", "A");
                    var b = new Module("mod_b", "B");
                    var flow = new DataFlow("flow_ab", "mod_a", "mod_b", "order");
            """, "flow_ab");

        found!.Text.Should().Contain("new DataFlow");
    }

    [Fact]
    public void Finds_an_id_written_as_a_named_argument()
    {
        var found = Find("""
                    var ctx = new BoundedContext(id: "ctx_orders", name: "Ordering");
            """, "ctx_orders");

        found.Should().NotBeNull();
    }

    [Fact]
    public void Does_not_confuse_an_id_with_another_argument_that_happens_to_match()
    {
        // "mod_a" is the *fromId* of the flow, and the flow is declared later. Matching the first
        // literal anywhere in the statement would return the wrong line.
        var found = Find("""
                    var a = new Module("mod_a", "A");
                    var flow = new DataFlow("flow_ab", "mod_a", "mod_b", "order");
            """, "mod_a");

        found!.Text.Should().StartWith("var a =");
    }

    [Fact]
    public void Leaves_out_a_comment_that_sits_above_the_declaration()
    {
        // Leading trivia belongs to the file, not to this statement; including it makes the snippet
        // open with a blank line and someone else's sentence.
        var found = Find("""
                    // The boundary the whole thing hangs off.
                    var ctx = new BoundedContext("ctx_orders", "Ordering");
            """, "ctx_orders");

        found!.Text.Should().StartWith("var ctx");
    }

    [Fact]
    public void An_id_that_is_not_there_is_not_invented()
    {
        Find("""
                    var ctx = new BoundedContext("ctx_orders", "Ordering");
            """, "ctx_nothing").Should().BeNull();
    }

    [Fact]
    public void A_file_with_no_Build_method_yields_nothing()
    {
        var root = CSharpSyntaxTree.ParseText("public static class NotAModel { }").GetRoot();

        DslReader.FindDeclaration("/tmp/x.cs", root, "anything").Should().BeNull();
    }

    // ---- Through the engine, which is the path the canvas actually takes ----------------------

    [Fact]
    public async Task Reads_back_the_declaration_the_engine_itself_just_wrote()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-decl-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), """
            using Stemma.Model;

            namespace Scratch;

            public static class Architecture
            {
                public static Model Build()
                {
                    return Model.Of();
                }
            }
            """);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.ApplyAsync(new AddElementOp("op_1", ArchElementKind.BoundedContext, "Ordering"));
            result.Should().BeOfType<OperationApplied>();

            var arch = await engine.ReadArchModelAsync();
            var added = arch!.Elements.Should().ContainSingle().Subject;

            var declaration = await engine.ReadDeclarationAsync(added.Id);

            // This is the strip the user is shown after their first click, so it has to be the real
            // file: the right path, a line that exists, and the text that is on it.
            declaration.Should().NotBeNull();
            declaration!.Text.Should().Contain("new BoundedContext").And.Contain("Ordering");
            declaration.FilePath.Should().EndWith("Architecture.cs");
            declaration.Line.Should().BePositive();

            var lines = await File.ReadAllLinesAsync(declaration.FilePath);
            lines[declaration.Line - 1].Trim().Should().Be(declaration.Text);
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
