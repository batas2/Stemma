using Stemma.Web;

// The backend as a process. The application itself is `StemmaWebHost`, because the desktop shell
// hosts the very same object in-process and needs to drive its lifetime rather than a child's
// (ADR-0017).
await StemmaWebHost.RunAsync(StemmaWebHost.Build(args));

public sealed record OpenWorkspaceRequest(string RootPath);
public sealed record InitWorkspaceRequest(string RootPath, string? Name);

public sealed record BookPdfPageRequest(string ViewId, string Title, string Narrative, string? CapturePngBase64);
public sealed record BookPdfRequest(string Name, string? Audience, IReadOnlyList<BookPdfPageRequest> Pages);

public partial class Program;

/// <summary>Body of the runtime level change (AC2).</summary>
record SetLevelRequest(string Level);
