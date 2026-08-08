using FluentAssertions;
using Microsoft.Extensions.Logging;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Diagnostics;
using Stemma.Engine.Operations;
using Stemma.Engine.Workspace;
using Xunit;

namespace Stemma.Engine.Tests;

/// <summary>
/// A logger that keeps what it was told, so the level discipline in ADR-0020 is a test rather than a
/// convention. Levels rot silently otherwise: nothing fails when `Information` slowly becomes a
/// progress firehose.
/// </summary>
public sealed class RecordingLoggerProvider : ILoggerProvider
{
    public sealed record Record(LogLevel Level, EventId EventId, string Category, string Message, Exception? Exception);

    private readonly List<Record> _records = [];
    private readonly LogLevel _minimum;

    public RecordingLoggerProvider(LogLevel minimum = LogLevel.Trace) => _minimum = minimum;

    public IReadOnlyList<Record> Records { get { lock (_records) return _records.ToList(); } }

    public ILogger CreateLogger(string categoryName) => new Recorder(this, categoryName);
    public void Dispose() { }

    private void Add(Record r) { lock (_records) _records.Add(r); }

    private sealed class Recorder(RecordingLoggerProvider owner, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => level >= owner._minimum;

        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(level)) return;
            owner.Add(new Record(level, eventId, category, formatter(state, exception), exception));
        }
    }
}

public class DiagnosticsTests
{
    private const string ProjectFile = """
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <TargetFramework>net8.0</TargetFramework>
            <Nullable>enable</Nullable>
            <ImplicitUsings>enable</ImplicitUsings>
            <LangVersion>latest</LangVersion>
          </PropertyGroup>
          <ItemGroup>
            <ProjectReference Include="STEMMA_MODEL_PATH" />
          </ItemGroup>
        </Project>
        """;

    private static async Task<TestArchWorkspace> CreateAsync(string buildBody)
    {
        var modelProj = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "Stemma.Model", "Stemma.Model.csproj"));
        var arch = $$"""
            using Stemma.Model;

            namespace Sample;

            public static class Architecture
            {
                public static Model Build()
                {
                    {{buildBody}}
                    return Model.Of();
                }
            }
            """;
        return await TestArchWorkspace.CreateAsync(ProjectFile.Replace("STEMMA_MODEL_PATH", modelProj), arch);
    }

    private static (ILogger<StemmaEngine> Logger, RecordingLoggerProvider Provider) Recording(LogLevel minimum = LogLevel.Trace)
    {
        var provider = new RecordingLoggerProvider(minimum);
        var factory = LoggerFactory.Create(b => { b.SetMinimumLevel(minimum); b.AddProvider(provider); });
        return (factory.CreateLogger<StemmaEngine>(), provider);
    }

    private const string TwoModules = """
            var a = new Module("mod_a", "A");
            var b = new Module("mod_b", "B");
    """;

    // ---- AC1: exactly one record per operation --------------------------------------------------

    [Fact]
    public async Task A_successful_operation_emits_exactly_one_Information_record()
    {
        // The test that stops `Information` silting up into a progress firehose.
        var (logger, provider) = Recording();
        await using var ws = await CreateAsync(TwoModules);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath, default, logger);

        var before = provider.Records.Count(r => r.Level == LogLevel.Information);
        await engine.ApplyAsync(new AddElementOp("op1", ArchElementKind.Module, "Onboarding"));

        provider.Records.Count(r => r.Level == LogLevel.Information && r.EventId.Id == 1101)
            .Should().Be(1, "one operation, one outcome, one record");
        provider.Records.Count(r => r.Level == LogLevel.Information).Should().BeGreaterThan(before);
    }

    [Fact]
    public async Task A_failed_operation_emits_exactly_one_Error_record()
    {
        var (logger, provider) = Recording();
        await using var ws = await CreateAsync(TwoModules);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath, default, logger);

        await engine.ApplyAsync(new RenameElementOp("op1", "mod_does_not_exist", "Nope"));

        provider.Records.Count(r => r.Level == LogLevel.Error).Should().Be(1);
        provider.Records.Single(r => r.Level == LogLevel.Error).EventId.Id.Should().Be(1102);
    }

    [Fact]
    public async Task No_operation_completes_without_a_record()
    {
        var (logger, provider) = Recording();
        await using var ws = await CreateAsync(TwoModules);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath, default, logger);

        var ops = new OperationBase[]
        {
            new AddElementOp("op1", ArchElementKind.Module, "One"),
            new RenameElementOp("op2", "mod_a", "Renamed"),
            new RenameElementOp("op3", "mod_missing", "Nope"),
        };
        var outcomeIds = new[] { 1101, 1102 };
        var before = provider.Records.Count(r => outcomeIds.Contains(r.EventId.Id));

        foreach (var op in ops) await engine.ApplyAsync(op);

        provider.Records.Count(r => outcomeIds.Contains(r.EventId.Id)).Should().Be(before + ops.Length);
    }

    [Fact]
    public async Task Opening_a_workspace_reports_what_was_loaded()
    {
        var (logger, provider) = Recording();
        await using var ws = await CreateAsync(TwoModules);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath, default, logger);

        provider.Records.Should().Contain(r => r.EventId.Id == 1001 && r.Level == LogLevel.Information);
    }

    // ---- AC8: logging must not perturb rewrites ------------------------------------------------

    [Fact]
    public async Task A_rewrite_is_byte_identical_with_logging_at_Trace_and_at_None()
    {
        // The guard that stops a future contributor "just tidying up" inside a rewrite path while
        // adding a log line. Proven by comparing bytes, not by inspection.
        const string body = """
                // A comment that must survive.
                var a = new Module("mod_a", "A");
                    var b   =   new Module( "mod_b" ,  "B" ) ;   // awkward on purpose
        """;

        await using var quiet = await CreateAsync(body);
        await using var quietEngine = await StemmaEngine.OpenAsync(quiet.RootPath);
        await quietEngine.ApplyAsync(new RenameElementOp("op1", "mod_a", "Renamed"));
        var withoutLogging = await quiet.ReadArchAsync();

        var (logger, provider) = Recording(LogLevel.Trace);
        await using var loud = await CreateAsync(body);
        await using var loudEngine = await StemmaEngine.OpenAsync(loud.RootPath, default, logger);
        await loudEngine.ApplyAsync(new RenameElementOp("op1", "mod_a", "Renamed"));
        var withLogging = await loud.ReadArchAsync();

        withLogging.Should().Be(withoutLogging, "logging observes a rewrite, it never participates in one");
        provider.Records.Should().NotBeEmpty("and the Trace run really was logging");
    }

    // ---- §3.5: the fidelity record -------------------------------------------------------------

    [Fact]
    public async Task A_write_records_the_content_hashes_at_Debug()
    {
        var (logger, provider) = Recording(LogLevel.Debug);
        await using var ws = await CreateAsync(TwoModules);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath, default, logger);

        await engine.ApplyAsync(new RenameElementOp("op1", "mod_a", "Renamed"));

        var rewrite = provider.Records.Should().ContainSingle(r => r.EventId.Id == 1201).Subject;
        rewrite.Level.Should().Be(LogLevel.Debug);
        rewrite.Message.Should().Contain("->", "a rewrite record is a before and an after");
    }

    [Fact]
    public async Task The_expensive_diff_is_emitted_only_at_Trace()
    {
        var (debugLogger, debugProvider) = Recording(LogLevel.Debug);
        await using var a = await CreateAsync(TwoModules);
        await using var debugEngine = await StemmaEngine.OpenAsync(a.RootPath, default, debugLogger);
        await debugEngine.ApplyAsync(new RenameElementOp("op1", "mod_a", "X"));
        debugProvider.Records.Should().NotContain(r => r.EventId.Id == 1202);

        var (traceLogger, traceProvider) = Recording(LogLevel.Trace);
        await using var b = await CreateAsync(TwoModules);
        await using var traceEngine = await StemmaEngine.OpenAsync(b.RootPath, default, traceLogger);
        await traceEngine.ApplyAsync(new RenameElementOp("op1", "mod_a", "X"));
        traceProvider.Records.Should().Contain(r => r.EventId.Id == 1202);
    }

    [Fact]
    public async Task An_engine_built_without_a_logger_still_works_and_says_nothing()
    {
        // The engine has to stay constructible and embeddable with no logging stack present at all.
        await using var ws = await CreateAsync(TwoModules);
        await using var engine = await StemmaEngine.OpenAsync(ws.RootPath);
        var result = await engine.ApplyAsync(new RenameElementOp("op1", "mod_a", "Renamed"));
        result.Should().BeOfType<OperationApplied>();
    }
}
