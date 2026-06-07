using System.Text.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Verso.Engine.ArchModel;
using Verso.Engine.Operations;
using Xunit;

namespace Verso.Web.Tests;

/// <summary>
/// Regression guard for the op-binding break: the polymorphic <see cref="OperationBase"/>
/// discriminator is "kind", and a derived op (the Epic-08 YAML ops) had a property also named
/// "Kind". System.Text.Json refuses to build the type metadata for the WHOLE hierarchy in that
/// case, so EVERY op failed to deserialize over SignalR ("Error binding arguments") — meaning
/// nothing the UI did (add element, add link, inspector edits) reached the engine.
///
/// These tests deserialize through the same options the SignalR JSON protocol is configured with
/// in Program.cs (camelCase + string enums), so a reintroduced "kind"-named property fails here.
/// </summary>
public class OperationBindingTests
{
    private static JsonSerializerOptions Opts()
    {
        var o = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return o;
    }

    [Fact]
    public void AddElement_op_binds_from_the_envelope_the_client_sends()
    {
        const string json = """{"kind":"AddElement","opId":"op_1","elementKind":"module","name":"Orders"}""";
        var op = JsonSerializer.Deserialize<OperationBase>(json, Opts());
        op.Should().BeOfType<AddElementOp>();
        var add = (AddElementOp)op!;
        add.ElementKind.Should().Be(ArchElementKind.Module);
        add.Name.Should().Be("Orders");
        add.OpId.Should().Be("op_1");
    }

    [Fact]
    public void AddLink_op_with_an_enum_binds()
    {
        const string json = """{"kind":"AddLink","opId":"op_2","linkKind":"dependency","fromId":"a","toId":"b"}""";
        var op = JsonSerializer.Deserialize<OperationBase>(json, Opts());
        op.Should().BeOfType<AddLinkOp>();
        ((AddLinkOp)op!).LinkKind.Should().Be(ArchLinkKind.Dependency);
    }

    [Fact]
    public void Inspector_string_op_binds()
    {
        const string json = """{"kind":"SetLifecycle","opId":"op_3","targetId":"mod_1","status":"current","phase":null,"validFrom":null,"validUntil":null}""";
        var op = JsonSerializer.Deserialize<OperationBase>(json, Opts());
        op.Should().BeOfType<SetLifecycleOp>();
    }
}
