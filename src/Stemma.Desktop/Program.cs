using System.Runtime.InteropServices;
using Photino.NET;
using Stemma.Desktop;

// `stemma-desktop` — Stemma in a window it owns (F-002, ADR-0017).
//
// One process: Kestrel binds a port the OS chooses, a native WebKitGTK window loads it, and closing
// the window ends both. The web app inside is the same build a browser tab gets; the only thing it
// gains here is a real folder picker.

var options = DesktopOptions.Parse(args);
if (options.ShowHelp)
{
    Console.WriteLine(DesktopOptions.Usage);
    return 0;
}
if (options.ShowVersion)
{
    Console.WriteLine($"stemma-desktop {Stemma.Engine.Diagnostics.StemmaVersion.Release}");
    return 0;
}

var geometryPath = WindowGeometry.DefaultPath;
var tracker = new GeometryTracker(WindowGeometry.Load(geometryPath));
var saved = tracker.Current;

var backend = BackendSession.Create(options.HostArgs);
// Started alongside the window rather than before it, so the first thing the user sees is a window.
var starting = Task.Run(() => backend.StartAsync(options.WorkspacePath));

var window = new PhotinoWindow()
    .SetTitle("Stemma")
    .SetUseOsDefaultSize(false)
    .SetSize(saved.Width, saved.Height)
    .SetMinSize(WindowGeometry.MinimumWidth, WindowGeometry.MinimumHeight)
    .SetMaximized(saved.Maximized)
    // The canvas has its own right-click menu; the webview's would cover it.
    .SetContextMenuEnabled(false)
    // The renderer here is WebKitGTK while the app is developed against Chromium, so the one thing
    // that must never be missing is a way to look at what it is actually doing.
    .SetDevToolsEnabled(true)
    .LoadRawString(Splash.Launching());

if (saved.HasPosition) window.SetUseOsDefaultLocation(false).SetLocation(new System.Drawing.Point(saved.Left, saved.Top));
else window.Center();

var bridge = new ShellBridge(
    (title, defaultPath) => window.ShowOpenFolder(title, defaultPath, multiSelect: false)?.FirstOrDefault(),
    window.SendWebMessage);

window
    .RegisterWebMessageReceivedHandler((_, message) => bridge.Receive(message))
    .RegisterSizeChangedHandler((_, size) => tracker.Resized(size.Width, size.Height))
    .RegisterLocationChangedHandler((_, point) => tracker.Moved(point.X, point.Y))
    .RegisterMaximizedHandler((_, _) => tracker.MaximizedChanged(true))
    .RegisterRestoredHandler((_, _) => tracker.MaximizedChanged(false))
    .RegisterWindowCreatedHandler((sender, eventArgs) =>
    {
        _ = eventArgs;
        if (sender is not PhotinoWindow created) return;
        // Where the window actually landed. On a first run that is wherever Center() put it, and
        // nothing else ever reports it: the move handler only fires when the user moves the window.
        tracker.Moved(created.Left, created.Top);
        PullOntoAScreen(created, tracker);
        _ = ShowTheAppWhenItIsReady(created, starting);
    });

// Ctrl-C in the terminal that launched it, or a session ending, should close the window rather than
// kill the process where it stands — otherwise the last thing the user did to the window is not
// remembered and the backend never gets to shut down cleanly.
var closeRequested = 0;
void RequestClose(PosixSignalContext context)
{
    // A second signal means the first did not take. Let the default handler have it.
    if (Interlocked.Exchange(ref closeRequested, 1) == 1) return;
    context.Cancel = true;
    try { window.Invoke(window.Close); }
    catch (Exception) { context.Cancel = false; }
}

using (PosixSignalRegistration.Create(PosixSignal.SIGINT, RequestClose))
using (PosixSignalRegistration.Create(PosixSignal.SIGTERM, RequestClose))
{
    window.WaitForClose();
}

tracker.Current.Save(geometryPath);
await backend.DisposeAsync();
return 0;

// A saved position can name a monitor that is no longer attached, and a window off the work area has
// no title bar to drag it back by. Checked once the window exists, because that is when the monitors
// can be enumerated.
static void PullOntoAScreen(PhotinoWindow window, GeometryTracker tracker)
{
    if (tracker.Current.Maximized || !tracker.Current.HasPosition) return;
    try
    {
        var clamped = tracker.Current.ClampTo(window.MainMonitor.WorkArea);
        if (clamped.Left == tracker.Current.Left && clamped.Top == tracker.Current.Top) return;
        window.MoveTo(clamped.Left, clamped.Top, allowOutsideWorkArea: false);
    }
    catch (Exception)
    {
        // No monitor information is a reason to leave the window where the OS put it, not to fail.
    }
}

static async Task ShowTheAppWhenItIsReady(PhotinoWindow window, Task<string> starting)
{
    try
    {
        var url = await starting;
        window.Invoke(() => window.Load(new Uri(url)));
    }
    catch (Exception e)
    {
        // Not a blank window and not a dead page: the reason, and where to read more (F-002 §4).
        var html = Splash.Failed(e.Message, BackendSession.LogDirectory);
        try { window.Invoke(() => window.LoadRawString(html)); }
        catch (Exception) { Console.Error.WriteLine($"stemma-desktop: {e.Message}"); }
    }
}
