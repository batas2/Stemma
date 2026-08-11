using System.Net;

namespace Stemma.Desktop;

/// <summary>
/// The two things the window shows before the app does.
///
/// A window that opens white and stays white for a second reads as a hang, and a window that opens
/// white and stays white forever — the backend failed — reads as a broken product with nothing to
/// report. Both states are drawn here, in plain HTML with no dependency on the SPA, because the SPA
/// is precisely what is not available yet.
/// </summary>
internal static class Splash
{
    public static string Launching() => Page($$"""
        <div class="mark">{{Mark}}</div>
        <p class="title">Stemma</p>
        <p class="detail pulse">Starting…</p>
        """);

    /// <summary>
    /// The backend did not come up. Names the reason and the log directory, because "it did not
    /// start" without either is a bug report nobody can act on (ADR-0020).
    /// </summary>
    public static string Failed(string reason, string logDirectory) => Page($"""
        <div class="mark">{Mark}</div>
        <p class="title">Stemma could not start</p>
        <p class="detail">{Escape(reason)}</p>
        <p class="hint">The log is in <code>{Escape(logDirectory)}</code>.</p>
        """);

    private const string Mark = """
        <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true">
          <defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#818cf8"/><stop offset="100%" stop-color="#4f46e5"/>
          </linearGradient></defs>
          <path d="M8 4 H19 L26 11 V26 A2 2 0 0 1 24 28 H8 A2 2 0 0 1 6 26 V6 A2 2 0 0 1 8 4 Z" fill="url(#m)"/>
          <path d="M19 4 V10 A1 1 0 0 0 20 11 H26 L19 4 Z" fill="#a5b4fc"/>
          <path d="M11.5 14 L16 22 L20.5 14" fill="none" stroke="#fff" stroke-width="2.2"
                stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.92"/>
        </svg>
        """;

    // System font stack and relative units throughout: the shell has to follow the system font scale
    // (F-002 §4), and a splash with a hard-coded pixel type size is the first place that breaks.
    private static string Page(string body) => $$"""
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="color-scheme" content="light dark">
          <title>Stemma</title>
          <style>
            :root {
              --bg: #ffffff; --fg: #18181b; --muted: #71717a; --faint: #a1a1aa;
              --code-bg: #f4f4f5;
            }
            @media (prefers-color-scheme: dark) {
              :root { --bg: #18181b; --fg: #fafafa; --muted: #a1a1aa; --faint: #71717a;
                      --code-bg: #27272a; }
            }
            html, body { height: 100%; margin: 0; }
            body {
              background: var(--bg); color: var(--fg);
              font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              gap: 0.4rem; text-align: center; padding: 2rem;
            }
            .mark { line-height: 0; margin-bottom: 0.6rem; }
            .title { font-size: 1rem; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
            .detail { font-size: 0.8125rem; color: var(--muted); margin: 0; max-width: 34rem;
                      line-height: 1.5; }
            .hint { font-size: 0.75rem; color: var(--faint); margin: 0.6rem 0 0; }
            code { background: var(--code-bg); border-radius: 3px; padding: 0.1em 0.35em;
                   font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.95em; }
            .pulse { animation: fade 1.6s ease-in-out infinite; }
            @keyframes fade { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
            @media (prefers-reduced-motion: reduce) {
              .pulse { animation: none; opacity: 0.75; }
            }
          </style>
        </head>
        <body>{{body}}</body>
        </html>
        """;

    private static string Escape(string value) => WebUtility.HtmlEncode(value);
}
