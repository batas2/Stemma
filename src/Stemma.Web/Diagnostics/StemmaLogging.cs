using Serilog;
using Serilog.Events;
using Serilog.Formatting.Compact;

namespace Stemma.Web.Diagnostics;

/// <summary>
/// Where the logging stack is composed, and the only file in the solution that names a sink.
///
/// Everything else logs through `ILogger`, so swapping the provider is a change here and nowhere
/// else. The engine never sees this file at all — it depends on the abstraction only (ADR-0020).
///
/// **There is no network sink, and adding one is a code change that must come back through an ADR.**
/// A Stemma record carries element and context names, ownership and risk annotations, absolute paths
/// and potentially C# source: that is the user's confidential architecture, not incidental PII.
/// </summary>
public static class StemmaLogging
{
    /// <summary>Per-user machine state, beside the existing `recent.json`. Never in a workspace, never in Git.</summary>
    public static string DefaultLogDirectory =>
        Environment.GetEnvironmentVariable("STEMMA_LOG_DIR") is { Length: > 0 } dir
            ? dir
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".stemma", "logs");

    public static string LogFilePattern => Path.Combine(DefaultLogDirectory, "stemma-.log");

    /// <summary>
    /// Retention, enforced without the user doing anything.
    ///
    /// A modelling tool must never be the reason a laptop runs out of disk. Small files are also
    /// cheaper to read and to attach to an issue than one large one.
    /// </summary>
    public const long MaxBytesPerFile = 20L * 1024 * 1024;
    public const int MaxFiles = 10;
    public const int RetainedDays = 14;

    public sealed record Options(LogEventLevel MinimumLevel, string Format, bool FileSink, string Directory)
    {
        public bool IsJson => Format.Equals("json", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Resolve the configuration, low precedence to high: `appsettings.json`, then environment, then
    /// the command line that `run.sh` passes through.
    ///
    /// The format default is deliberate. `simple` is for a person at a terminal; `json` is what
    /// `stemma render` and anything else reading a pipe should get, so a non-TTY stdout flips it
    /// without anyone having to remember a flag.
    /// </summary>
    public static Options Resolve(IConfiguration config, string[] args)
    {
        var level = Read(args, "--log-level")
            ?? Environment.GetEnvironmentVariable("STEMMA_LOG_LEVEL")
            ?? config["Logging:LogLevel:Default"]
            ?? "Information";

        var format = Read(args, "--log-format")
            ?? Environment.GetEnvironmentVariable("STEMMA_LOG_FORMAT")
            ?? (Console.IsOutputRedirected ? "json" : "simple");

        var fileSink = (Environment.GetEnvironmentVariable("STEMMA_LOG_FILE") ?? "on")
            .Equals("on", StringComparison.OrdinalIgnoreCase);

        return new Options(ParseLevel(level), format, fileSink, DefaultLogDirectory);
    }

    /// <summary>An unrecognised level is a typo, not a reason to refuse to start.</summary>
    public static LogEventLevel ParseLevel(string? raw) => raw?.Trim().ToLowerInvariant() switch
    {
        "trace" or "verbose" => LogEventLevel.Verbose,
        "debug" => LogEventLevel.Debug,
        "information" or "info" => LogEventLevel.Information,
        "warning" or "warn" => LogEventLevel.Warning,
        "error" => LogEventLevel.Error,
        "critical" or "fatal" => LogEventLevel.Fatal,
        "none" or "off" => (LogEventLevel)int.MaxValue,
        _ => LogEventLevel.Information,
    };

    private static string? Read(string[] args, string flag)
    {
        var i = Array.IndexOf(args, flag);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    /// <summary>
    /// Build the logger. `levelSwitch` is what makes AC2 work: raising a category at runtime changes
    /// this switch, and every sink follows without a restart.
    /// </summary>
    public static Serilog.Core.Logger Build(Options options, Serilog.Core.LoggingLevelSwitch levelSwitch)
    {
        levelSwitch.MinimumLevel = options.MinimumLevel;

        var config = new LoggerConfiguration()
            .MinimumLevel.ControlledBy(levelSwitch)
            .Enrich.FromLogContext();

        if (options.IsJson)
            config = config.WriteTo.Console(new CompactJsonFormatter());
        else
            config = config.WriteTo.Console(
                outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}");

        if (options.FileSink)
        {
            Directory.CreateDirectory(options.Directory);
            config = config.WriteTo.File(
                new CompactJsonFormatter(),
                Path.Combine(options.Directory, "stemma-.log"),
                rollingInterval: RollingInterval.Day,
                fileSizeLimitBytes: MaxBytesPerFile,
                rollOnFileSizeLimit: true,
                retainedFileCountLimit: MaxFiles,
                retainedFileTimeLimit: TimeSpan.FromDays(RetainedDays),
                shared: true);
        }

        return config.CreateLogger();
    }
}
