using System.Text.Json;

namespace Stemma.Desktop;

/// <summary>
/// The only thing the page can ask the window for.
///
/// The web app is the same build that runs in a browser tab, so it cannot depend on the shell being
/// there; everything here is a request the page makes optionally and degrades from. Today that is
/// one request — the OS folder picker, which is the capability a tab genuinely cannot have and the
/// reason F-002 exists at all.
///
/// The bridge takes its picker and its reply channel as delegates rather than reaching for a window,
/// which is what makes the protocol testable without a webview.
/// </summary>
public sealed class ShellBridge(ShellBridge.FolderPicker pickFolder, Action<string> respond)
{
    /// <summary>Returns the chosen folder, or null when the user cancelled.</summary>
    public delegate string? FolderPicker(string title, string defaultPath);

    public const string PickFolder = "pickFolder";

    /// <summary>
    /// Handle one message from the page. Never throws: this runs on the native message callback, and
    /// an exception crossing that boundary takes the window with it. Every message that carries an
    /// id is answered exactly once — a page awaiting a reply that never comes is a hang, which is a
    /// worse failure than an error it can show.
    /// </summary>
    public void Receive(string? message)
    {
        string? id = null;
        try
        {
            if (string.IsNullOrWhiteSpace(message)) return;

            using var document = JsonDocument.Parse(message);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;

            id = Text(root, "id");
            var type = Text(root, "type");
            if (type is null) return;

            switch (type)
            {
                case PickFolder:
                    var chosen = pickFolder(
                        Text(root, "title") ?? "Choose a folder",
                        Text(root, "defaultPath") ?? "");
                    Reply(new { id, type, ok = chosen is not null, path = chosen });
                    break;

                default:
                    Fail(id, type, $"the shell does not handle '{type}'");
                    break;
            }
        }
        catch (JsonException)
        {
            // Not addressed to anyone we can answer — there is no id to reply to.
        }
        catch (Exception e)
        {
            Fail(id, "error", e.Message);
        }
    }

    private void Fail(string? id, string type, string message)
    {
        if (id is null) return;
        Reply(new { id, type, ok = false, error = message });
    }

    private void Reply(object payload)
    {
        try { respond(JsonSerializer.Serialize(payload)); }
        catch (Exception) { /* the window is going away; there is nothing left to tell */ }
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
