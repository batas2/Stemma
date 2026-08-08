using System.Security.Cryptography;
using System.Text;

namespace Stemma.Web.Diagnostics;

/// <summary>
/// One id from the click to the Roslyn write.
///
/// The client generates a correlation id per *user action* rather than per request — one canvas drag
/// can produce several calls, and they belong together. This opens a logging scope carrying it, so
/// every record emitted downstream inherits it without a single call site having to pass it along.
///
/// The payoff is the acceptance test: one grep on a correlation id returns the HTTP call, the
/// operation, the document write, the fidelity hashes and the broadcast that told the other panels
/// to refresh — in order.
/// </summary>
public sealed class CorrelationMiddleware(RequestDelegate next, ILogger<CorrelationMiddleware> log)
{
    public const string HeaderName = "X-Correlation-Id";

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers[HeaderName].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(correlationId)) correlationId = Guid.NewGuid().ToString("N")[..12];

        // Echoed so a client-side error record can name the exchange that produced it.
        context.Response.Headers[HeaderName] = correlationId;

        using (log.BeginScope(new Dictionary<string, object>
        {
            ["correlationId"] = correlationId,
            ["requestPath"] = context.Request.Path.Value ?? "",
        }))
        {
            await next(context);
        }
    }
}

/// <summary>
/// A workspace's identity for a log record, without its path.
///
/// The absolute root path names the user's machine and often their client. An HMAC of it is stable
/// for the life of the process and unreadable in a bundle, which is what correlation actually needs —
/// records grouped by workspace, not a path anyone can read back.
///
/// The key is per-process on purpose: it makes the id useless outside the session it was written in,
/// which is the right trade for a value that only ever has to correlate records inside one bundle.
/// </summary>
public static class WorkspaceIdentity
{
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);

    public static string For(string? rootPath)
    {
        if (string.IsNullOrEmpty(rootPath)) return "(none)";
        var mac = HMACSHA256.HashData(Key, Encoding.UTF8.GetBytes(rootPath));
        return Convert.ToHexStringLower(mac)[..12];
    }
}
