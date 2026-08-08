using Microsoft.Extensions.Logging;

namespace Stemma.Engine.Diagnostics;

/// <summary>
/// Every record the engine emits, declared once (ADR-0020).
///
/// Source-generated partial methods rather than `logger.LogInformation(...)` calls, for three
/// reasons that all matter here: the message template is parsed at compile time instead of on every
/// call, value-type arguments are not boxed, and — the one that is not about performance —
/// **an interpolated string cannot be redacted**, because by the time the logger sees it there are
/// no properties left to erase. The diagnostics bundle depends on those properties existing.
///
/// Event ids are grouped by subsystem and are stable. They are what someone greps for in a bundle
/// pasted into an issue, so they outrank the message text: reword a message freely, never renumber.
/// </summary>
internal static partial class EngineLog
{
    // ---- Stemma.Engine.Workspace — 1000–1099 ---------------------------------------------------

    [LoggerMessage(EventId = 1001, Level = LogLevel.Information,
        Message = "Workspace opened: {ElementCount} elements, {LinkCount} links, {DocumentCount} documents in {ElapsedMs} ms")]
    public static partial void WorkspaceOpened(ILogger logger, int elementCount, int linkCount, int documentCount, long elapsedMs);

    [LoggerMessage(EventId = 1002, Level = LogLevel.Error,
        Message = "Workspace failed to open")]
    public static partial void WorkspaceOpenFailed(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 1003, Level = LogLevel.Warning,
        Message = "MSBuild reported a problem loading the workspace; project references may be missing: {Message}")]
    public static partial void WorkspaceLoadDiagnostic(ILogger logger, string message);

    [LoggerMessage(EventId = 1004, Level = LogLevel.Debug,
        Message = "Loader selected: {LoaderKind}")]
    public static partial void LoaderSelected(ILogger logger, string loaderKind);

    [LoggerMessage(EventId = 1005, Level = LogLevel.Information,
        Message = "Workspace closed")]
    public static partial void WorkspaceClosed(ILogger logger);

    // ---- Stemma.Engine.Operations — 1100–1199 --------------------------------------------------

    [LoggerMessage(EventId = 1101, Level = LogLevel.Information,
        Message = "Operation {OperationType} applied in {ElapsedMs} ms ({DeltaCount} deltas)")]
    public static partial void OperationApplied(ILogger logger, string operationType, long elapsedMs, int deltaCount);

    [LoggerMessage(EventId = 1102, Level = LogLevel.Error,
        Message = "Operation {OperationType} failed after {ElapsedMs} ms: {Reason}")]
    public static partial void OperationFailed(ILogger logger, string operationType, long elapsedMs, string reason, Exception? exception);

    [LoggerMessage(EventId = 1103, Level = LogLevel.Warning,
        Message = "Could not snapshot the model before {OperationType}; undo will not be available for this operation")]
    public static partial void UndoSnapshotUnavailable(ILogger logger, string operationType, Exception exception);

    // ---- Stemma.Engine.Fidelity — 1200–1299 ----------------------------------------------------

    [LoggerMessage(EventId = 1201, Level = LogLevel.Debug,
        Message = "Document rewritten: {DocumentPath} {BeforeHash} -> {AfterHash} ({BeforeLength} -> {AfterLength} bytes)")]
    public static partial void DocumentRewritten(ILogger logger, string documentPath, string beforeHash, string afterHash, int beforeLength, int afterLength);

    [LoggerMessage(EventId = 1202, Level = LogLevel.Trace,
        Message = "Rewrite diff for {DocumentPath}:\n{Diff}")]
    public static partial void RewriteDiff(ILogger logger, string documentPath, string diff);

    [LoggerMessage(EventId = 1203, Level = LogLevel.Critical,
        Message = "Fidelity verification FAILED for {DocumentPath} after {OperationType}: re-parsed text does not match the intended tree ({IntendedHash} vs {WrittenHash}). The file on disk may be damaged.")]
    public static partial void FidelityVerificationFailed(ILogger logger, string documentPath, string operationType, string intendedHash, string writtenHash);

    [LoggerMessage(EventId = 1204, Level = LogLevel.Debug,
        Message = "Document unchanged by {OperationType}: {DocumentPath}")]
    public static partial void DocumentUnchanged(ILogger logger, string operationType, string documentPath);

    // ---- Stemma.Engine.Watcher — 1300–1399 -----------------------------------------------------

    [LoggerMessage(EventId = 1301, Level = LogLevel.Information,
        Message = "External change detected in {DocumentPath}; reloading")]
    public static partial void ExternalChangeDetected(ILogger logger, string documentPath);

    [LoggerMessage(EventId = 1302, Level = LogLevel.Warning,
        Message = "External change handling failed; the canvas may be showing stale content until the next edit")]
    public static partial void ExternalChangeFailed(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 1304, Level = LogLevel.Warning,
        Message = "File watcher stopped: {Reason}. External edits will not be picked up until the workspace is reopened.")]
    public static partial void WatcherStopped(ILogger logger, string reason, Exception? exception);
}
