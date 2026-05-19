using System.Diagnostics;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Verso.Engine.Discovery;
using Verso.Engine.Models;

namespace Verso.Web.Services;

/// <summary>
/// Brokers Claude calls for the discovery views (per Epic 06 / ADR-0008). The Engine layer
/// never imports the Anthropic SDK; this class is the only LLM seam.
///
/// Two transports ship: <see cref="HttpClaudeTransport"/> (Anthropic Messages API, pay-per-token)
/// and <see cref="ClaudeCliTransport"/> (subprocess against the local <c>claude</c> CLI, uses the
/// architect's existing Claude Code login). Selection is via env <c>VERSO_AI_TRANSPORT</c>.
/// Tests inject stubs.
/// </summary>
public sealed class AiBroker
{
    private readonly IClaudeTransport _transport;

    public AiBroker(IClaudeTransport transport) => _transport = transport;

    /// <summary>
    /// True when the chosen transport is ready to make calls. HTTP needs an API key;
    /// CLI needs the <c>claude</c> binary on PATH.
    /// </summary>
    public bool IsConfigured => _transport.IsAvailable;

    public string TransportLabel => _transport.Label;

    public async Task<AiAnalysisResult> AnalyseModuleAsync(
        AnalyseModuleRequest request,
        WorkspaceModel workspace,
        DiscoveryBundle bundle,
        CancellationToken ct = default)
    {
        if (!_transport.IsAvailable)
        {
            return new AiAnalysisResult(false, "TransportUnavailable",
                $"Claude transport `{_transport.Label}` is not configured. " +
                "For HTTP: set $ANTHROPIC_API_KEY or write ~/.verso/credentials.json. " +
                "For CLI: install Claude Code and run `claude login`.",
                null);
        }

        var module = bundle.Discovered.Modules.FirstOrDefault(m => m.Id == request.ModuleId);
        if (module is null)
        {
            return new AiAnalysisResult(false, "ModuleNotFound",
                $"Module '{request.ModuleId}' is not in the discovered model.", null);
        }

        var (system, user, model, maxTokens, temperature) = BuildPrompt(request.Template, module, workspace, bundle);

        try
        {
            var response = await _transport.SendAsync(new ClaudeRequest(
                Model: model,
                System: system,
                Messages: new[] { new ClaudeMessage("user", user) },
                MaxTokens: maxTokens,
                Temperature: temperature), ct);
            var jsonText = ExtractFirstJson(response.Text);
            return new AiAnalysisResult(true, null, null, jsonText);
        }
        catch (Exception ex)
        {
            return new AiAnalysisResult(false, "TransportFailure", ex.Message, null);
        }
    }

    private static (string System, string User, string Model, int MaxTokens, double Temperature) BuildPrompt(
        string template, DiscoveredModule module, WorkspaceModel workspace, DiscoveryBundle bundle)
    {
        var moduleMetric = bundle.Metrics.Modules.FirstOrDefault(m => m.ModuleId == module.Id);
        var sourceFiles = TrySnippetSourceFiles(module, workspace, byteCap: 30_000);
        var workspaceSummary = $"Workspace `{Path.GetFileName(workspace.RootPath)}`: " +
            $"{workspace.Projects.Count} projects, {workspace.AllTypes.Count()} types, " +
            $"{bundle.Discovered.Modules.Count} discovered modules.";

        return template switch
        {
            "summarise" => (
                System: PromptTemplates.SummariseSystem,
                User: $"# Target module\n{ModuleHeader(module)}\n\n# Source\n{sourceFiles}\n\n# Metrics\n{ModuleMetricBlock(moduleMetric)}\n\nReturn JSON only.",
                Model: "claude-haiku-4-5-20251001",
                MaxTokens: 800,
                Temperature: 0.2),
            "propose-views" => (
                System: PromptTemplates.ProposeViewsSystem,
                User: $"# Discovered model (summary)\n{DiscoveredSummary(bundle.Discovered)}\n\n# Metrics\n{MetricsSummary(bundle.Metrics)}\n\n# Existing views\n(none yet)\n\nReturn JSON only.",
                Model: "claude-opus-4-7",
                MaxTokens: 2400,
                Temperature: 0.4),
            _ /* "discover-structure" */ => (
                System: PromptTemplates.DiscoverStructureSystem,
                User: $"# Workspace summary\n{workspaceSummary}\n\n# Target module\n{ModuleHeader(module)}\n\n# Module dependencies\n{ModuleEdgesBlock(module, bundle.Discovered.Edges)}\n\n# Source files\n{sourceFiles}\n\n# Metrics\n{ModuleMetricBlock(moduleMetric)}\n\nProduce the analysis as JSON only.",
                Model: "claude-opus-4-7",
                MaxTokens: 2400,
                Temperature: 0.0),
        };
    }

    private static string ModuleHeader(DiscoveredModule m) =>
        $"id: {m.Id}\nname: {m.Name}\nproject: {m.ProjectId}\nnamespace: {m.NamespacePrefix}\nfiles: {m.TypeIds.Count}";

    private static string ModuleMetricBlock(ModuleMetric? m) => m is null ? "(no metrics)"
        : $"types={m.TypeCount}, Ca={m.Ca}, Ce={m.Ce}, I={m.Instability}, A={m.Abstractness}, D={m.DistanceFromMainSequence}, RC={m.RelationalCohesion}";

    private static string ModuleEdgesBlock(DiscoveredModule module, IReadOnlyList<DependencyEdge> edges)
    {
        var ids = module.TypeIds.ToHashSet();
        var rel = edges.Where(e => ids.Contains(e.FromTypeId) || ids.Contains(e.ToTypeId)).Take(40).ToList();
        if (rel.Count == 0) return "(no edges)";
        return string.Join('\n', rel.Select(e =>
            $"- {e.Kind} ({e.Transport}) {e.FromTypeId} → {e.ToTypeId} {(e.External ? "[external]" : string.Empty)}"));
    }

    private static string TrySnippetSourceFiles(DiscoveredModule module, WorkspaceModel ws, int byteCap)
    {
        var paths = ws.AllTypes.Where(t => module.TypeIds.Contains(t.Id))
            .Select(t => t.FilePath).Distinct().OrderBy(p => p).ToList();
        var sb = new StringBuilder();
        var bytes = 0;
        foreach (var path in paths)
        {
            if (!File.Exists(path)) continue;
            try
            {
                var content = File.ReadAllText(path);
                var header = $"\n## {Path.GetFileName(path)}\n```\n";
                if (bytes + content.Length + header.Length > byteCap) { sb.Append("\n# (truncated)\n"); break; }
                sb.Append(header).Append(content).Append("\n```\n");
                bytes += content.Length + header.Length;
            }
            catch { /* ignore */ }
        }
        return sb.Length == 0 ? "(no source files readable)" : sb.ToString();
    }

    private static string DiscoveredSummary(DiscoveredModel d)
    {
        var modules = string.Join('\n', d.Modules.Select(m =>
            $"- {m.Id}: {m.Name} ({m.TypeIds.Count} types, project={m.ProjectId})"));
        return $"projects={d.Projects.Count}, namespaces={d.Namespaces.Count}, modules={d.Modules.Count}\n{modules}";
    }

    private static string MetricsSummary(WorkspaceMetrics m) =>
        string.Join('\n', m.Modules.Select(mm =>
            $"- {mm.ModuleName}: types={mm.TypeCount}, I={mm.Instability}, A={mm.Abstractness}, D={mm.DistanceFromMainSequence}"));

    public static string? ExtractFirstJson(string text)
    {
        var open = text.IndexOf('{');
        var close = text.LastIndexOf('}');
        if (open < 0 || close <= open) return null;
        return text.Substring(open, close - open + 1);
    }
}

public sealed record AnalyseModuleRequest(string ModuleId, string Template);

public sealed record AiAnalysisResult(
    bool Ok,
    string? ErrorCode,
    string? ErrorMessage,
    string? ResultJson);

/// <summary>Abstraction over "get a Claude response for this prompt." Two impls in v1: HTTP API, CLI subprocess.</summary>
public interface IClaudeTransport
{
    /// <summary>Short identifier used in error messages and the AI status endpoint.</summary>
    string Label { get; }

    /// <summary>True when the transport can make a call right now.</summary>
    bool IsAvailable { get; }

    Task<ClaudeResponse> SendAsync(ClaudeRequest request, CancellationToken ct);
}

public sealed record ClaudeMessage(string Role, string Content);
public sealed record ClaudeRequest(string Model, string System, IReadOnlyList<ClaudeMessage> Messages, int MaxTokens, double Temperature);
public sealed record ClaudeResponse(string Text);

/// <summary>
/// Anthropic Messages API transport. Pay-per-token; needs an API key from
/// <c>$ANTHROPIC_API_KEY</c> or <c>~/.verso/credentials.json#anthropicApiKey</c>.
/// </summary>
public sealed class HttpClaudeTransport : IClaudeTransport
{
    private readonly HttpClient _http;
    private readonly Func<string?> _apiKeyResolver;

    public HttpClaudeTransport(HttpClient? http = null, Func<string?>? apiKeyResolver = null)
    {
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        _apiKeyResolver = apiKeyResolver ?? DefaultApiKey;
    }

    public string Label => "http";
    public bool IsAvailable => !string.IsNullOrWhiteSpace(_apiKeyResolver());

    public async Task<ClaudeResponse> SendAsync(ClaudeRequest request, CancellationToken ct)
    {
        var apiKey = _apiKeyResolver()
            ?? throw new InvalidOperationException("ANTHROPIC_API_KEY not configured.");
        var msgList = request.Messages.Select(m => new { role = m.Role, content = m.Content }).ToList();
        var body = new
        {
            model = request.Model,
            system = request.System,
            messages = msgList,
            max_tokens = request.MaxTokens,
            temperature = request.Temperature,
        };
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages")
        {
            Content = JsonContent.Create(body, options: new JsonSerializerOptions(JsonSerializerDefaults.Web)),
        };
        req.Headers.Add("x-api-key", apiKey);
        req.Headers.Add("anthropic-version", "2023-06-01");
        var resp = await _http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var text = json.RootElement.GetProperty("content").EnumerateArray()
            .Where(e => e.GetProperty("type").GetString() == "text")
            .Select(e => e.GetProperty("text").GetString() ?? string.Empty)
            .FirstOrDefault() ?? string.Empty;
        return new ClaudeResponse(text);
    }

    private static string? DefaultApiKey()
    {
        var env = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
        if (!string.IsNullOrWhiteSpace(env)) return env;
        var home = Environment.GetEnvironmentVariable("HOME") ?? Environment.GetEnvironmentVariable("USERPROFILE");
        if (string.IsNullOrEmpty(home)) return null;
        var path = Path.Combine(home, ".verso", "credentials.json");
        if (!File.Exists(path)) return null;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            return doc.RootElement.TryGetProperty("anthropicApiKey", out var v) ? v.GetString() : null;
        }
        catch { return null; }
    }
}

/// <summary>
/// Claude Code CLI transport. Spawns <c>claude --print --output-format json --model … "&lt;user&gt;"</c>
/// with the system prompt passed via <c>--append-system-prompt</c>. Authentication is whatever
/// <c>claude login</c> set up — no separate API key.
///
/// The process invocation is injectable so unit tests don't need the binary.
/// </summary>
public sealed class ClaudeCliTransport : IClaudeTransport
{
    private readonly Func<ProcessSpec, CancellationToken, Task<ProcessResult>> _runner;
    private readonly Func<bool> _availabilityCheck;

    public ClaudeCliTransport(
        Func<ProcessSpec, CancellationToken, Task<ProcessResult>>? runner = null,
        Func<bool>? availabilityCheck = null)
    {
        _runner = runner ?? DefaultRunner;
        _availabilityCheck = availabilityCheck ?? DetectClaudeBinary;
    }

    public string Label => "cli";
    public bool IsAvailable => _availabilityCheck();

    public async Task<ClaudeResponse> SendAsync(ClaudeRequest request, CancellationToken ct)
    {
        // The Messages API distinguishes system + user; the CLI takes a single prompt arg.
        // We render them as a Markdown-fenced bundle and rely on Claude Code's prompt instruction
        // to follow the structured-JSON contract from PromptTemplates.
        var prompt = $"{request.System}\n\n---\n\n{request.Messages.First().Content}";

        var args = new List<string>
        {
            "--print",
            "--output-format", "json",
            "--model", request.Model,
            "--permission-mode", "default",
        };
        var spec = new ProcessSpec(
            FileName: "claude",
            Arguments: args,
            Stdin: prompt,
            TimeoutSeconds: 120);

        var result = await _runner(spec, ct);
        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"`claude` exited {result.ExitCode}. Stderr: {result.StdErr.Trim()}");
        }

        // `claude --output-format json` emits a single JSON object on stdout with a "result" field
        // containing the assistant's final text. Fall back to raw stdout if the shape changes.
        var text = TryReadResultField(result.StdOut) ?? result.StdOut;
        return new ClaudeResponse(text);
    }

    private static string? TryReadResultField(string stdout)
    {
        try
        {
            using var doc = JsonDocument.Parse(stdout);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            if (doc.RootElement.TryGetProperty("result", out var v) && v.ValueKind == JsonValueKind.String)
                return v.GetString();
            return null;
        }
        catch { return null; }
    }

    private static bool DetectClaudeBinary()
    {
        try
        {
            var psi = new ProcessStartInfo("claude", "--version")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            if (proc is null) return false;
            if (!proc.WaitForExit(2000)) { try { proc.Kill(); } catch { } return false; }
            return proc.ExitCode == 0;
        }
        catch { return false; }
    }

    private static async Task<ProcessResult> DefaultRunner(ProcessSpec spec, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(spec.FileName)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in spec.Arguments) psi.ArgumentList.Add(a);

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException($"Failed to start `{spec.FileName}`. Is it on PATH?");
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        if (!string.IsNullOrEmpty(spec.Stdin))
        {
            await proc.StandardInput.WriteAsync(spec.Stdin);
        }
        proc.StandardInput.Close();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(spec.TimeoutSeconds));
        try
        {
            await proc.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(true); } catch { }
            throw new TimeoutException($"`{spec.FileName}` did not return within {spec.TimeoutSeconds}s.");
        }
        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        return new ProcessResult(proc.ExitCode, stdout, stderr);
    }
}

public sealed record ProcessSpec(string FileName, IReadOnlyList<string> Arguments, string Stdin, int TimeoutSeconds);
public sealed record ProcessResult(int ExitCode, string StdOut, string StdErr);

internal static class PromptTemplates
{
    public const string DiscoverStructureSystem = """
        You are a software architecture analyst embedded in Verso, a tool that treats C# source code as the model database.

        Your task: given the source of a single module from a brownfield C# solution, identify its structure honestly. You are not a coding assistant. You do not produce code. You produce a structured analysis used to drive architecture views.

        Rules.
        1. Ground every claim in the supplied source. If a sub-module name, responsibility, or smell is not directly evidenced by the files in the prompt, do not name it. State "insufficient evidence" instead.
        2. Cite file paths and line numbers for every non-trivial claim. Use the form path/to/File.cs:42-58.
        3. Distinguish observation from inference. Observations cite source. Inferences do not, but must be marked inference: true.
        4. Output strictly the JSON schema described in the user prompt. No prose outside JSON.
        """;

    public const string SummariseSystem = """
        You are a module summariser. Output JSON only with this shape:
        { "module_id": string, "summary": string, "responsibilities": string[], "risks": [{"name": string, "evidence": "file:lines", "severity": "info"|"warning"|"error"}], "confidence": number }
        Hard limits: summary ≤ 200 words; ≤ 3 responsibilities; ≤ 3 risks; no code.
        """;

    public const string ProposeViewsSystem = """
        You are a view-design assistant. Propose architecture views — named subsets of the model — that would tell the architect something they cannot see in the views they already have. Output JSON only:
        { "proposals": [{"name": string, "audience": string, "intent": string, "module_ids": string[], "edge_kinds": string[], "layout": "c4Context"|"moduleMap"|"dependencyGraph"|"swimlane"|"hierarchy"|"forceDirected", "value_score": number, "rationale": string}] }
        Maximum 7 proposals.
        """;
}
