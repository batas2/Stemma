using System.Text;
using System.Text.Json;
using FluentAssertions;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// The sidecar on disk, written through the engine (ADR-0021): a change lands on the file as it is
/// now, byte for byte around it; a file that cannot be read is left alone; and a change someone else
/// makes is announced, while the echo of the engine's own write is not (B-014).
/// </summary>
public sealed class SidecarWriteTests
{
    private const string Source = """
        using Stemma.Model;

        namespace Scratch;

        public static class Architecture
        {
            public static Model Build()
            {
                var ctx = new BoundedContext("ctx_001", "Ordering");
                return Model.Of(ctx);
            }
        }
        """;

    private const string Sidecar = """
        {
          "version": 1,
          "views": {
            "moduleMap": {
              "nodes": {
                "ctx_001": {
                  "x": 10,
                  "y": 20
                }
              }
            }
          }
        }

        """;

    private static readonly byte[] Bom = [0xEF, 0xBB, 0xBF];

    private static async Task<string> CreateAsync(byte[]? sidecar)
    {
        var root = Path.Combine(Path.GetTempPath(), $"stemma-sidecar-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "Architecture"));
        await File.WriteAllTextAsync(Path.Combine(root, "Architecture", "Architecture.cs"), Source);
        if (sidecar is not null) await File.WriteAllBytesAsync(LayoutSidecar.PathFor(root), sidecar);
        return root;
    }

    private static SidecarChange Set(string json, params string[] path) =>
        new(path, JsonDocument.Parse(json).RootElement.Clone());

    private static async Task<bool> EventuallyAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return true;
            await Task.Delay(100);
        }
        return false;
    }

    [Fact]
    public async Task A_change_lands_on_the_file_and_keeps_its_byte_order_mark()
    {
        var root = await CreateAsync([.. Bom, .. Encoding.UTF8.GetBytes(Sidecar)]);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.PatchSidecarAsync("op", [Set("42", "views", "moduleMap", "nodes", "ctx_001", "y")]);

            result.Should().BeOfType<OperationApplied>();
            (await File.ReadAllBytesAsync(LayoutSidecar.PathFor(root))).Should()
                .Equal([.. Bom, .. Encoding.UTF8.GetBytes(Sidecar.Replace("\"y\": 20", "\"y\": 42"))]);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_workspace_without_a_sidecar_gets_one_that_names_its_schema()
    {
        var root = await CreateAsync(null);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            (await engine.PatchSidecarAsync("op", [Set("\"Owns ordering.\"", "notes", "ctx_001")])).Should().BeOfType<OperationApplied>();

            (await File.ReadAllTextAsync(LayoutSidecar.PathFor(root))).Should().Be($$"""
                {
                  "$schema": "{{LayoutSidecar.SchemaUrl}}",
                  "version": 1,
                  "notes": {
                    "ctx_001": "Owns ordering."
                  }
                }

                """);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_sidecar_that_cannot_be_read_is_refused_and_left_as_it_is()
    {
        // A merge left its markers in; reading it as empty and writing that back would lose both sides.
        var conflicted = "{\n<<<<<<< HEAD\n  \"version\": 1\n=======\n  \"version\": 2\n>>>>>>> theirs\n}\n";
        var root = await CreateAsync(Encoding.UTF8.GetBytes(conflicted));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.PatchSidecarAsync("op", [Set("1", "version")]);

            result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("UnreadableSidecar");
            (await File.ReadAllTextAsync(LayoutSidecar.PathFor(root))).Should().Be(conflicted);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task An_outside_change_is_announced_and_the_engines_own_write_is_not()
    {
        var root = await CreateAsync(Encoding.UTF8.GetBytes(Sidecar));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            engine.StartWatching();
            var announced = 0;
            engine.SidecarChanged += () => Interlocked.Increment(ref announced);
            await Task.Delay(TimeSpan.FromSeconds(1));

            await engine.PatchSidecarAsync("op", [Set("42", "views", "moduleMap", "nodes", "ctx_001", "y")]);
            await Task.Delay(TimeSpan.FromSeconds(3)); // several watcher polls
            announced.Should().Be(0, "the engine's own write is not news");

            var outside = (await File.ReadAllTextAsync(LayoutSidecar.PathFor(root))).Replace("\"x\": 10", "\"x\": 99");
            await File.WriteAllTextAsync(LayoutSidecar.PathFor(root), outside);
            (await EventuallyAsync(() => announced > 0)).Should().BeTrue("a pull or a hand edit is");
            await Task.Delay(TimeSpan.FromSeconds(3));
            announced.Should().Be(1, "once per change");
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_file_that_is_not_utf8_is_refused_and_left_as_it_is()
    {
        // A note saved by an editor in Windows-1250: read loosely, its bytes became U+FFFD and the whole
        // file was written back with them, though only `version` was changed.
        var bytes = Encoding.UTF8.GetBytes(Sidecar.Replace("\"nodes\"", "\"notes\": { \"a\": \"Za\u0001\" },\n      \"nodes\""))
            .Select(b => b == 0x01 ? (byte)0xBF : b).ToArray();
        var root = await CreateAsync(bytes);
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.PatchSidecarAsync("op", [Set("2", "version")]);

            result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("UnreadableSidecar");
            (await File.ReadAllBytesAsync(LayoutSidecar.PathFor(root))).Should().Equal(bytes);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task A_reader_never_sees_half_a_file_while_it_is_being_written()
    {
        // The file was emptied and then written in place: a reader in between got a torn file (17 times
        // in 400 reads), and a write cancelled in between left it empty. It is replaced whole now.
        var root = await CreateAsync(Encoding.UTF8.GetBytes(Sidecar));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var path = LayoutSidecar.PathFor(root);
            var torn = 0;
            using var stop = new CancellationTokenSource();
            var reader = Task.Run(async () =>
            {
                while (!stop.IsCancellationRequested)
                {
                    try { JsonDocument.Parse(await File.ReadAllTextAsync(path)).Dispose(); }
                    catch (JsonException) { torn++; }
                    catch (IOException) { /* replaced between open and read: not a torn read */ }
                }
            });
            for (var i = 0; i < 150; i++)
                (await engine.PatchSidecarAsync($"op{i}", [Set(i.ToString(), "views", "moduleMap", "nodes", "ctx_001", "y")]))
                    .Should().BeOfType<OperationApplied>();
            stop.Cancel();
            await reader;

            torn.Should().Be(0);
            Directory.GetFiles(root, "*.tmp", SearchOption.AllDirectories).Should().BeEmpty();
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Half_an_emoji_in_a_change_is_a_refusal_not_a_crash()
    {
        var root = await CreateAsync(Encoding.UTF8.GetBytes(Sidecar));
        try
        {
            await using var engine = await StemmaEngine.OpenAsync(root);
            var result = await engine.PatchSidecarAsync("op", [Set("\"\\ud83d\"", "notes", "a")]);
            result.Should().BeOfType<OperationFailed>().Which.Reason.Should().Be("UnreadableSidecar");
            (await engine.PatchSidecarAsync("op2", [Set("\"ok\"", "notes", "a")])).Should().BeOfType<OperationApplied>();
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
