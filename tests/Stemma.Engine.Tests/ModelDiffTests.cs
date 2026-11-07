using System.Text.Json;
using System.Text.Json.Serialization;
using FluentAssertions;
using Stemma.Engine.ArchModel;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// <see cref="ModelDiff"/> against the cases the client's <c>diffModels</c> runs too
/// (<c>tests/shared/model-diff.cases.json</c>, ADR-0031): the same two models give the same changes in
/// the same words, whichever side says them.
/// </summary>
public sealed class ModelDiffTests
{
    private static readonly JsonSerializerOptions Api = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private sealed record Expected(string Id, string Change, IReadOnlyList<string> Details);
    private sealed record Expectation(IReadOnlyList<Expected> Elements, IReadOnlyList<Expected> Links);
    private sealed record Case(string Name, ArchModel.ArchModel? Before, ArchModel.ArchModel After, Expectation Expected);

    private static IReadOnlyList<Case> All()
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Shared", "model-diff.cases.json"));
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.GetProperty("cases").Deserialize<List<Case>>(Api)!;
    }

    public static TheoryData<string> Names()
    {
        var data = new TheoryData<string>();
        foreach (var c in All()) data.Add(c.Name);
        return data;
    }

    [Theory]
    [MemberData(nameof(Names))]
    public void Says_what_the_client_says(string name)
    {
        var c = All().Single(x => x.Name == name);
        var changes = ModelDiff.Compare(c.Before, c.After);

        changes.Elements.Select(e => new Expected(e.Id, Camel(e.Change), e.Details)).Should()
            .BeEquivalentTo(c.Expected.Elements, o => o.WithStrictOrdering());
        changes.Links.Select(l => new Expected(l.Id, Camel(l.Change), l.Details)).Should()
            .BeEquivalentTo(c.Expected.Links, o => o.WithStrictOrdering());
    }

    [Fact]
    public void The_counts_read_as_the_status_bar_reads_them()
    {
        var c = All().Single(x => x.Name == "additions and removals, of elements and links");
        var changes = ModelDiff.Compare(c.Before, c.After);
        (changes.Added, changes.Removed, changes.Changed, changes.Total).Should().Be((2, 2, 0, 4));
        ModelDiff.DescribeCounts(changes).Should().Be("2 added · 2 removed");
        ModelDiff.DescribeCounts(ModelDiff.Compare(c.Before, c.Before!)).Should().Be("No changes");
    }

    private static string Camel(ChangeKind kind) => kind.ToString().ToLowerInvariant();
}
