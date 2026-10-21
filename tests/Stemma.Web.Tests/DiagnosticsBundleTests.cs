using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Stemma.Web.Diagnostics;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The bundle is the artifact that travels, so these are about what must not be in it.
///
/// A Stemma record carries element and context names, ownership annotations, absolute paths and
/// sometimes C# source. That is the user's confidential architecture, and the bundle is what gets
/// pasted into a public issue.
/// </summary>
public class DiagnosticsBundleTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-bundle-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private void WriteLog(string name, params string[] lines) =>
        File.WriteAllLines(Path.Combine(_dir, name), lines);

    private static string Record(string message, params (string Key, string Value)[] props)
    {
        var o = new Dictionary<string, object> { ["@t"] = "2026-08-08T10:00:00Z", ["@l"] = "Information", ["@mt"] = message };
        foreach (var (k, v) in props) o[k] = v;
        return JsonSerializer.Serialize(o);
    }

    private static readonly IReadOnlyDictionary<string, string> NoEnvironment = new Dictionary<string, string>();

    // ---- AC9: redacted by default --------------------------------------------------------------

    [Fact]
    public void Redacts_model_content_by_default()
    {
        WriteLog("stemma-20260808.log", Record("Operation applied", ("DocumentPath", "/home/someone/client-project/Architecture/Architecture.cs")));

        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: false), NoEnvironment);

        bundle.Should().NotContain("client-project");
        bundle.Should().Contain(DiagnosticsBundle.Erased);
    }

    [Fact]
    public void Keeps_the_shape_that_makes_a_bundle_useful()
    {
        // Redaction must not erase the level, the event id, the timestamp or the correlation id —
        // without those a bundle is a list of "[redacted]" and helps nobody.
        WriteLog("stemma-20260808.log", Record("Operation applied", ("DocumentPath", "/secret/a.cs"), ("correlationId", "abc123")));

        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: false), NoEnvironment);

        bundle.Should().Contain("Information").And.Contain("abc123").And.Contain("2026-08-08");
    }

    [Fact]
    public void The_opt_in_really_does_include_model_content()
    {
        WriteLog("stemma-20260808.log", Record("Operation applied", ("DocumentPath", "/home/someone/proj/Architecture.cs")));

        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: true), NoEnvironment);

        bundle.Should().Contain("Architecture.cs");
    }

    [Fact]
    public void Reduces_an_absolute_path_that_appears_inside_an_unclassified_value()
    {
        // A path can arrive in a property nobody thought to classify. Reducing every absolute path
        // is the backstop for that.
        WriteLog("stemma-20260808.log", Record("Something", ("SomeOtherField", "failed reading /home/someone/private/repo/file.cs")));

        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: false), NoEnvironment);

        bundle.Should().NotContain("/home/someone/private");
        bundle.Should().Contain("repo/file.cs", "enough to recognise the file, not enough to identify anyone");
    }

    [Fact]
    public void A_record_that_is_not_json_is_erased_whole_rather_than_leaked()
    {
        // It cannot be inspected property by property, so it cannot be partially redacted either.
        WriteLog("stemma-20260808.log", "this is not json and mentions /home/someone/secret.cs");

        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: false), NoEnvironment);

        bundle.Should().NotContain("secret.cs");
        bundle.Should().Contain("unparseable record");
    }

    [Fact]
    public void An_interpolated_message_cannot_be_redacted_and_this_test_says_so()
    {
        // The executable form of the §3.6 limitation: redaction works on properties, and a message
        // built by interpolation has none. This is why ADR-0020 forbids interpolation in a log call
        // rather than merely discouraging it.
        var interpolated = JsonSerializer.Serialize(new
        {
            @t = "2026-08-08T10:00:00Z",
            @l = "Information",
            // No properties — the path was baked into the text at the call site.
            @m = "Operation applied to Architecture/Sales.cs for element ctx_confidential",
        });
        WriteLog("stemma-20260808.log", interpolated);

        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: false), NoEnvironment);

        bundle.Should().Contain("ctx_confidential",
            "an interpolated message survives redaction — which is precisely why they are forbidden");
    }

    [Fact]
    public void Environment_facts_are_redacted_too()
    {
        var environment = new Dictionary<string, string> { ["home"] = "/home/someone/projects/secret" };
        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: false), environment);
        bundle.Should().NotContain("/home/someone/projects");
    }

    [Fact]
    public void Caps_how_much_it_takes_so_the_attachment_stays_sendable()
    {
        WriteLog("stemma-20260808.log", Enumerable.Range(0, 2000).Select(i => Record($"record {i}")).ToArray());

        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: true, MaxRecords: 50), NoEnvironment);

        using var doc = JsonDocument.Parse(bundle);
        doc.RootElement.GetProperty("recordCount").GetInt32().Should().Be(50);
    }

    [Fact]
    public void Takes_the_newest_records_when_today_has_fewer_than_the_cap()
    {
        // The log rolls daily, so early in a day the newest file is short. Its records were read
        // first and yesterday's appended after them, so the cap kept yesterday's and dropped the
        // failure the user had just met.
        WriteLog("stemma-20260807.log", Enumerable.Range(0, 600).Select(i => Record($"yesterday {i}")).ToArray());
        WriteLog("stemma-20260808.log", Enumerable.Range(0, 10).Select(i => Record($"today {i}")).ToArray());
        File.SetLastWriteTimeUtc(Path.Combine(_dir, "stemma-20260807.log"), new DateTime(2026, 8, 7, 23, 0, 0, DateTimeKind.Utc));
        File.SetLastWriteTimeUtc(Path.Combine(_dir, "stemma-20260808.log"), new DateTime(2026, 8, 8, 9, 0, 0, DateTimeKind.Utc));

        var bundle = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: true, MaxRecords: 500), NoEnvironment);

        using var doc = JsonDocument.Parse(bundle);
        var messages = doc.RootElement.GetProperty("records").EnumerateArray()
            .Select(r => JsonDocument.Parse(r.GetString()!).RootElement.GetProperty("@mt").GetString())
            .ToList();
        messages.Should().HaveCount(500);
        messages[^10..].Should().Equal(Enumerable.Range(0, 10).Select(i => $"today {i}"), "the newest records are the reason the bundle exists");
        messages[0].Should().Be("yesterday 110", "the rest is the most recent of the day before, oldest first");
    }

    [Fact]
    public void Says_plainly_whether_it_was_redacted()
    {
        var open = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: true), NoEnvironment);
        var closed = DiagnosticsBundle.Build(_dir, new DiagnosticsBundle.Options(IncludeModelContent: false), NoEnvironment);

        JsonDocument.Parse(open).RootElement.GetProperty("redacted").GetBoolean().Should().BeFalse();
        JsonDocument.Parse(closed).RootElement.GetProperty("redacted").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public void A_missing_log_directory_produces_an_empty_bundle_rather_than_an_error()
    {
        var bundle = DiagnosticsBundle.Build(Path.Combine(_dir, "does-not-exist"),
            new DiagnosticsBundle.Options(IncludeModelContent: false), NoEnvironment);
        JsonDocument.Parse(bundle).RootElement.GetProperty("recordCount").GetInt32().Should().Be(0);
    }
}

/// <summary>
/// AC10 — no log record leaves the machine, and none can be made to without a code change.
/// </summary>
public class NoNetworkSinkTests
{
    [Fact]
    public void No_network_capable_sink_is_referenced()
    {
        // Enforced against the assembly's actual references rather than against the project file, so
        // a transitive one is caught too. Adding a network sink must be a deliberate code change
        // that comes back through an ADR, not something a package restore can introduce.
        var referenced = typeof(StemmaLogging).Assembly
            .GetReferencedAssemblies()
            .Select(a => a.Name ?? "")
            .ToList();

        var networkSinks = new[] { "Serilog.Sinks.Http", "Serilog.Sinks.Seq", "Serilog.Sinks.Elasticsearch",
                                   "Serilog.Sinks.Splunk", "Serilog.Sinks.Network", "Serilog.Sinks.Datadog",
                                   "OpenTelemetry.Exporter.OpenTelemetryProtocol" };

        referenced.Should().NotIntersectWith(networkSinks);
    }

    [Fact]
    public void Composing_the_logger_loads_no_sink_beyond_console_and_file()
    {
        // Asserted after actually building the logger. Inspecting loaded assemblies without doing so
        // proves nothing, because nothing has forced them to load yet.
        var dir = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"stemma-sinks-{Guid.NewGuid():N}")).FullName;
        try
        {
            using var logger = StemmaLogging.Build(
                new StemmaLogging.Options(Serilog.Events.LogEventLevel.Information, "json", FileSink: true, dir),
                new Serilog.Core.LoggingLevelSwitch());
            logger.Information("forcing the sinks to initialise");

            var sinks = AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => a.GetName().Name ?? "")
                .Where(n => n.StartsWith("Serilog.Sinks.", StringComparison.Ordinal))
                .ToList();

            sinks.Should().NotBeEmpty("the logger was built with sinks");
            sinks.Should().OnlyContain(n => n == "Serilog.Sinks.File" || n == "Serilog.Sinks.Console");
        }
        finally { Directory.Delete(dir, recursive: true); }
    }

    [Fact]
    public void The_log_directory_is_per_user_machine_state_not_workspace_content()
    {
        // A log inside a workspace would end up in the user's Git history, which is the one place a
        // record carrying their architecture must never be.
        StemmaLogging.DefaultLogDirectory.Should().Contain(".stemma");
    }

    [Fact]
    public void Retention_is_bounded_without_the_user_doing_anything()
    {
        StemmaLogging.MaxBytesPerFile.Should().BeLessThanOrEqualTo(20L * 1024 * 1024);
        StemmaLogging.MaxFiles.Should().BeLessThanOrEqualTo(20);
        StemmaLogging.RetainedDays.Should().BeLessThanOrEqualTo(14);
    }
}

/// <summary>Configuration precedence and the level parser (AC2, AC3).</summary>
public class LoggingOptionsTests
{
    [Fact]
    public void An_unknown_level_falls_back_rather_than_refusing_to_start()
    {
        StemmaLogging.ParseLevel("chatty").Should().Be(Serilog.Events.LogEventLevel.Information);
        StemmaLogging.ParseLevel(null).Should().Be(Serilog.Events.LogEventLevel.Information);
    }

    [Theory]
    [InlineData("trace", Serilog.Events.LogEventLevel.Verbose)]
    [InlineData("Debug", Serilog.Events.LogEventLevel.Debug)]
    [InlineData("WARN", Serilog.Events.LogEventLevel.Warning)]
    [InlineData("critical", Serilog.Events.LogEventLevel.Fatal)]
    public void Accepts_the_names_people_actually_type(string raw, Serilog.Events.LogEventLevel expected)
    {
        StemmaLogging.ParseLevel(raw).Should().Be(expected);
    }

    [Fact]
    public void Off_silences_everything_so_the_fidelity_comparison_has_a_baseline()
    {
        ((int)StemmaLogging.ParseLevel("none")).Should().BeGreaterThan((int)Serilog.Events.LogEventLevel.Fatal);
    }
}

/// <summary>
/// AC4 — the file sink, and the retention that must hold without the user doing anything. A
/// modelling tool must never be the reason a laptop runs out of disk.
/// </summary>
public class LogFileSinkTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-sink-{Guid.NewGuid():N}")).FullName;

    public void Dispose() { try { Directory.Delete(_dir, recursive: true); } catch (IOException) { /* the sink may still hold a handle */ } }

    private StemmaLogging.Options Options(bool fileSink = true) =>
        new(Serilog.Events.LogEventLevel.Information, "json", fileSink, _dir);

    [Fact]
    public void Writes_json_lines_that_a_bundle_can_read_back()
    {
        using (var logger = StemmaLogging.Build(Options(), new Serilog.Core.LoggingLevelSwitch()))
        {
            logger.Information("Workspace opened: {ElementCount} elements", 7);
        }

        var file = Directory.EnumerateFiles(_dir, "stemma-*.log").Should().ContainSingle().Subject;
        var line = File.ReadAllLines(file).Should().ContainSingle().Subject;

        // One JSON object per line is what makes the bundle readable and greppable at all.
        var doc = System.Text.Json.JsonDocument.Parse(line);
        doc.RootElement.TryGetProperty("@mt", out _).Should().BeTrue("the message template is kept, not a rendered blob");
        doc.RootElement.GetProperty("ElementCount").GetInt32().Should().Be(7, "properties stay structured");
    }

    [Fact]
    public void Rolls_rather_than_growing_one_file_without_limit()
    {
        using (var logger = StemmaLogging.Build(Options(), new Serilog.Core.LoggingLevelSwitch()))
        {
            // Comfortably past the per-file cap.
            var payload = new string('x', 4096);
            for (var i = 0; i < 8000; i++) logger.Information("bulk {Index} {Payload}", i, payload);
        }

        var files = Directory.EnumerateFiles(_dir, "stemma-*.log").ToList();
        files.Count.Should().BeGreaterThan(1, "the file rolled");
        files.Count.Should().BeLessThanOrEqualTo(StemmaLogging.MaxFiles, "and the retained count is capped");
        foreach (var f in files)
            new FileInfo(f).Length.Should().BeLessThanOrEqualTo((long)(StemmaLogging.MaxBytesPerFile * 1.5),
                "each file honours the size limit");
    }

    [Fact]
    public void Writes_nothing_when_the_file_sink_is_off()
    {
        using (var logger = StemmaLogging.Build(Options(fileSink: false), new Serilog.Core.LoggingLevelSwitch()))
        {
            logger.Information("console only");
        }
        Directory.EnumerateFiles(_dir).Should().BeEmpty();
    }

    [Fact]
    public void The_level_switch_changes_what_is_written_without_rebuilding_the_logger()
    {
        // AC2 — a runtime level change takes effect with no restart.
        var levelSwitch = new Serilog.Core.LoggingLevelSwitch();
        using (var logger = StemmaLogging.Build(Options(), levelSwitch))
        {
            logger.Debug("dropped at Information");
            levelSwitch.MinimumLevel = Serilog.Events.LogEventLevel.Debug;
            logger.Debug("kept after the switch");
        }

        var text = string.Join("\n", Directory.EnumerateFiles(_dir, "stemma-*.log").SelectMany(File.ReadAllLines));
        text.Should().NotContain("dropped at Information");
        text.Should().Contain("kept after the switch");
    }
}
