using Microsoft.Extensions.Logging;

namespace Stemma.Web.Diagnostics;

/// <summary>
/// Records emitted by the host. Declared, not interpolated, for the reasons in ADR-0020 — chiefly
/// that an interpolated message has no properties left for the bundle to redact.
///
/// Event ids: 2000–2099 API, 2100–2199 hub, 2200–2299 export. Stable; reword freely, never renumber.
/// </summary>
internal static partial class WebLog
{
    [LoggerMessage(EventId = 2001, Level = LogLevel.Information,
        Message = "Workspace open requested: {WorkspaceId}")]
    public static partial void WorkspaceOpenRequested(ILogger logger, string workspaceId);

    [LoggerMessage(EventId = 2002, Level = LogLevel.Error,
        Message = "Request failed: {Method} {Path}")]
    public static partial void RequestFailed(ILogger logger, string method, string path, Exception exception);

    [LoggerMessage(EventId = 2003, Level = LogLevel.Warning,
        Message = "Layout sidecar could not be written; positions from this session will not survive a reload")]
    public static partial void SidecarWriteFailed(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 2101, Level = LogLevel.Warning,
        Message = "SignalR broadcast '{Method}' failed; other panels will resync on reload")]
    public static partial void BroadcastFailed(ILogger logger, string method, Exception exception);

    [LoggerMessage(EventId = 2102, Level = LogLevel.Debug,
        Message = "Operation received over the hub: {OperationType} ({OpId})")]
    public static partial void HubOperationReceived(ILogger logger, string operationType, string opId);

    [LoggerMessage(EventId = 2201, Level = LogLevel.Information,
        Message = "Export produced: {Format} ({Bytes} bytes)")]
    public static partial void ExportProduced(ILogger logger, string format, long bytes);

    [LoggerMessage(EventId = 2004, Level = LogLevel.Information,
        Message = "Log level changed at runtime to {Level}")]
    public static partial void LevelChanged(ILogger logger, string level);
}
