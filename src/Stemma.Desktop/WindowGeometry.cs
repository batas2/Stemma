using System.Drawing;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Stemma.Desktop;

/// <summary>
/// Where the window was, and how big, last time (F-002 AC3).
///
/// This is <em>application</em> state, not model state and not view presentation, so it lives in the
/// per-user config directory and never in <c>stemma.layout.json</c> — reusing the sidecar for a
/// window size is exactly the drift inviolable rule 3 exists to prevent (ADR-0017).
/// </summary>
public sealed record WindowGeometry(int Width, int Height, int Left, int Top, bool Maximized)
{
    /// <summary>Roomy enough for the canvas and the two rails on a 1080p screen.</summary>
    public static readonly WindowGeometry Default = new(1440, 900, 0, 0, false);

    /// <summary>Below this the rails overlap the canvas and nothing is usable.</summary>
    public const int MinimumWidth = 900;
    public const int MinimumHeight = 600;

    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".stemma", "window.json");

    [JsonIgnore]
    public bool HasPosition => Left != 0 || Top != 0;

    /// <summary>
    /// Pull the window back onto a screen that exists.
    ///
    /// The failure this prevents is unrecoverable from inside the app: undock a laptop, launch, and
    /// the window restores onto a monitor that is no longer there — no title bar, no way to drag it
    /// back, and the only fix is deleting a file the user does not know about. A saved position is
    /// therefore a hint, and the work area is the authority.
    /// </summary>
    public WindowGeometry ClampTo(Rectangle workArea)
    {
        var width = Math.Clamp(Width, Math.Min(MinimumWidth, workArea.Width), Math.Max(workArea.Width, MinimumWidth));
        var height = Math.Clamp(Height, Math.Min(MinimumHeight, workArea.Height), Math.Max(workArea.Height, MinimumHeight));

        // Enough of the window has to be on the work area to grab it by the title bar; the whole
        // window does not have to be.
        var left = Math.Clamp(Left, workArea.Left, Math.Max(workArea.Left, workArea.Right - width));
        var top = Math.Clamp(Top, workArea.Top, Math.Max(workArea.Top, workArea.Bottom - height));

        return this with { Width = width, Height = height, Left = left, Top = top };
    }

    /// <summary>
    /// Read the saved geometry, or the default. Deliberately total: a corrupt or half-written file
    /// must cost the user their window position, never their launch.
    /// </summary>
    public static WindowGeometry Load(string path)
    {
        try
        {
            if (!File.Exists(path)) return Default;
            var geometry = JsonSerializer.Deserialize<WindowGeometry>(File.ReadAllText(path), JsonOptions);
            return geometry is null || geometry.Width <= 0 || geometry.Height <= 0 ? Default : geometry;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            return Default;
        }
    }

    /// <summary>Best-effort. A window position is not worth failing a shutdown over.</summary>
    public void Save(string path)
    {
        try
        {
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOptions));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };
}

/// <summary>
/// Follows the window while it is open.
///
/// The subtlety is maximised state: once maximised, the reported size is the screen's, so saving it
/// naively means un-maximising restores to a window that fills the screen and can never be told
/// apart from a maximised one again. Size and position are therefore only recorded while the window
/// is in its normal state.
/// </summary>
public sealed class GeometryTracker(WindowGeometry initial)
{
    private WindowGeometry _current = initial;

    public WindowGeometry Current => _current;

    public void Resized(int width, int height)
    {
        if (_current.Maximized || width <= 0 || height <= 0) return;
        _current = _current with { Width = width, Height = height };
    }

    public void Moved(int left, int top)
    {
        if (_current.Maximized) return;
        _current = _current with { Left = left, Top = top };
    }

    public void MaximizedChanged(bool maximized) => _current = _current with { Maximized = maximized };
}
