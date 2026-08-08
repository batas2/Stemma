using System.Text.Json;
using System.Text.RegularExpressions;

namespace Stemma.Web.Diagnostics;

/// <summary>
/// The artifact that travels — and therefore the one that is redacted.
///
/// Local logs stay unredacted: they are the user's own model on the user's own machine, and
/// redacting them would destroy the value to buy nothing. The bundle is different, because it is
/// pasted into an issue. Model content is erased and absolute paths are reduced, with an explicit
/// opt-in — never pre-ticked — for someone who can share their architecture.
///
/// The redaction is applied to the *record properties*, which is only possible because every record
/// goes through `[LoggerMessage]`. An interpolated message has no properties left to erase by the
/// time it reaches a sink, which is the practical reason ADR-0020 forbids interpolation.
/// </summary>
public static partial class DiagnosticsBundle
{
    /// <summary>Properties whose values are model content or identity. Erased unless opted in.</summary>
    private static readonly HashSet<string> SensitiveProperties = new(StringComparer.OrdinalIgnoreCase)
    {
        "DocumentPath", "WorkspacePath", "Path", "Diff", "Message",
        "ElementName", "ElementId", "Name", "Author", "Email",
    };

    public const string Erased = "[redacted]";

    public sealed record Options(bool IncludeModelContent, int MaxRecords = 500);

    /// <summary>
    /// Build a bundle from the newest records on disk plus the environment facts that explain them.
    ///
    /// Reads the tail rather than everything: a bundle is for the failure that just happened, and a
    /// 200 MB attachment helps nobody.
    /// </summary>
    public static string Build(string logDirectory, Options options, IReadOnlyDictionary<string, string> environment)
    {
        var records = ReadRecent(logDirectory, options.MaxRecords)
            .Select(line => Redact(line, options.IncludeModelContent))
            .ToList();

        var bundle = new
        {
            generated = DateTimeOffset.UtcNow.ToString("O"),
            redacted = !options.IncludeModelContent,
            environment = options.IncludeModelContent ? environment : Redact(environment),
            recordCount = records.Count,
            records,
        };
        return JsonSerializer.Serialize(bundle, new JsonSerializerOptions { WriteIndented = true });
    }

    private static IEnumerable<string> ReadRecent(string logDirectory, int max)
    {
        if (!Directory.Exists(logDirectory)) return [];
        var lines = new List<string>();
        foreach (var file in Directory.EnumerateFiles(logDirectory, "stemma-*.log")
                     .OrderByDescending(File.GetLastWriteTimeUtc))
        {
            try
            {
                // `shared: true` on the sink means the file is open for writing while we read it.
                using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                using var reader = new StreamReader(stream);
                while (reader.ReadLine() is { } line) lines.Add(line);
            }
            catch (IOException)
            {
                // A log we cannot read is not a reason to fail the bundle — the point is to produce
                // something the user can send, from whatever is available.
            }
            if (lines.Count >= max) break;
        }
        return lines.TakeLast(max);
    }

    /// <summary>
    /// Erase sensitive values while keeping the record's shape, so the level, the event id, the
    /// timestamp and the correlation id all survive — which is most of what makes a bundle useful.
    /// </summary>
    public static string Redact(string jsonLine, bool includeModelContent)
    {
        if (includeModelContent) return jsonLine;

        try
        {
            using var doc = JsonDocument.Parse(jsonLine);
            var output = new Dictionary<string, object?>();
            foreach (var property in doc.RootElement.EnumerateObject())
            {
                output[property.Name] = SensitiveProperties.Contains(property.Name)
                    ? Erased
                    : RedactValue(property.Value);
            }
            return JsonSerializer.Serialize(output);
        }
        catch (JsonException)
        {
            // A line that is not JSON cannot be inspected property by property, so it cannot be
            // partially redacted either. Erasing it whole is the only safe answer.
            return JsonSerializer.Serialize(new { note = "unparseable record", value = Erased });
        }
    }

    private static object? RedactValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => RedactPaths(value.GetString()),
        JsonValueKind.Object => value.EnumerateObject()
            .ToDictionary(p => p.Name, p => SensitiveProperties.Contains(p.Name) ? Erased : RedactValue(p.Value)),
        JsonValueKind.Array => value.EnumerateArray().Select(RedactValue).ToList(),
        _ => JsonSerializer.Deserialize<object>(value.GetRawText()),
    };

    private static IReadOnlyDictionary<string, string> Redact(IReadOnlyDictionary<string, string> environment) =>
        environment.ToDictionary(kv => kv.Key, kv => RedactPaths(kv.Value) ?? Erased);

    /// <summary>
    /// Absolute paths name the machine and often the client. Reduce them to their last two segments,
    /// which is enough to recognise a file and not enough to identify anyone.
    /// </summary>
    public static string? RedactPaths(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        return AbsolutePath().Replace(text, m =>
        {
            var parts = m.Value.Replace('\\', '/').TrimEnd('/').Split('/');
            return parts.Length <= 2 ? "…" : $"…/{parts[^2]}/{parts[^1]}";
        });
    }

    [GeneratedRegex(@"(?:[A-Za-z]:\\|/)(?:[^\s""'<>|:*?]+[/\\])*[^\s""'<>|:*?]*")]
    private static partial Regex AbsolutePath();
}
