using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Serilog.Events;
using Stemma.Web.Diagnostics;
using Xunit;

namespace Stemma.Web.Tests;

/// <summary>
/// The levels in appsettings are per category: the framework at Warning, Stemma at Information. The
/// logger honoured only the default, so every request wrote five framework records to the file —
/// and the diagnostics bundle, which keeps the last 500, was mostly "Request starting". A level
/// changed at runtime still has to reach every category that follows the default (AC2).
/// </summary>
public sealed class LoggingLevelTests : IDisposable
{
    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), $"stemma-levels-{Guid.NewGuid():N}")).FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static readonly Dictionary<string, string?> AppSettings = new()
    {
        ["Logging:LogLevel:Default"] = "Information",
        ["Logging:LogLevel:Microsoft.AspNetCore"] = "Warning",
        ["Logging:LogLevel:Stemma.Engine.Workspace"] = "Information",
        ["Logging:LogLevel:Stemma.Engine.Fidelity"] = "Debug",
    };

    /// <summary>Write one record per (category, level) through the logger the host builds; return what reached the file.</summary>
    private List<string> Written(Action<Serilog.Core.LoggingLevelSwitch>? change, params (string Category, LogEventLevel Level)[] records)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(AppSettings).Build();
        var options = StemmaLogging.Resolve(config, ["--log-format", "json"]) with { FileSink = true, Directory = _dir };
        var levelSwitch = new Serilog.Core.LoggingLevelSwitch();
        using (var logger = StemmaLogging.Build(options, levelSwitch))
        {
            change?.Invoke(levelSwitch);
            foreach (var (category, level) in records)
                logger.ForContext(Serilog.Core.Constants.SourceContextPropertyName, category).Write(level, "{Category} at {Level}", category, level);
        }
        return Directory.EnumerateFiles(_dir, "stemma-*.log")
            .SelectMany(File.ReadAllLines)
            .Select(line => JsonDocument.Parse(line).RootElement)
            .Select(r => $"{r.GetProperty("Category").GetString()} {r.GetProperty("Level").GetString()}")
            .ToList();
    }

    [Fact]
    public void A_category_configured_quieter_than_the_default_stays_quiet()
    {
        Written(null,
                ("Microsoft.AspNetCore.Hosting.Diagnostics", LogEventLevel.Information),
                ("Microsoft.AspNetCore.Routing.EndpointMiddleware", LogEventLevel.Warning),
                ("Stemma.Web.Api", LogEventLevel.Information))
            .Should().Equal("Microsoft.AspNetCore.Routing.EndpointMiddleware Warning", "Stemma.Web.Api Information");
    }

    [Fact]
    public void A_category_configured_louder_than_the_default_says_more()
    {
        Written(null,
                ("Stemma.Engine.Fidelity", LogEventLevel.Debug),
                ("Stemma.Engine.Workspace", LogEventLevel.Debug))
            .Should().Equal("Stemma.Engine.Fidelity Debug");
    }

    [Fact]
    public void Raising_the_level_at_runtime_reaches_what_follows_the_default_and_not_what_was_quieted()
    {
        Written(s => s.MinimumLevel = LogEventLevel.Debug,
                ("Stemma.Engine.Workspace", LogEventLevel.Debug),
                ("Stemma.Web.Api", LogEventLevel.Debug),
                ("Microsoft.AspNetCore.Hosting.Diagnostics", LogEventLevel.Information))
            .Should().Equal("Stemma.Engine.Workspace Debug", "Stemma.Web.Api Debug");
    }

    [Fact]
    public void Quieting_it_at_runtime_quiets_what_follows_the_default_and_the_framework_with_it()
    {
        // A category configured louder was asked for by name, and goes on saying that much.
        Written(s => s.MinimumLevel = LogEventLevel.Error,
                ("Microsoft.AspNetCore.Hosting.Diagnostics", LogEventLevel.Warning),
                ("Stemma.Engine.Fidelity", LogEventLevel.Debug),
                ("Stemma.Web.Api", LogEventLevel.Warning),
                ("Stemma.Web.Api", LogEventLevel.Error))
            .Should().Equal("Stemma.Engine.Fidelity Debug", "Stemma.Web.Api Error");
    }

    [Fact]
    public void Without_an_appsettings_file_the_framework_is_still_kept_quiet()
    {
        // Not every package ships appsettings.json.
        var options = StemmaLogging.Resolve(new ConfigurationBuilder().Build(), ["--log-format", "json"]);

        options.Categories.Should().ContainSingle()
            .Which.Should().Be(new StemmaLogging.CategoryLevel("Microsoft.AspNetCore", LogEventLevel.Warning, Quieter: true));
    }

    [Fact]
    public void Off_is_off_for_every_category()
    {
        Written(s => s.MinimumLevel = StemmaLogging.ParseLevel("none"),
                ("Stemma.Engine.Fidelity", LogEventLevel.Fatal),
                ("Microsoft.AspNetCore.Hosting.Diagnostics", LogEventLevel.Fatal))
            .Should().BeEmpty();
    }
}
