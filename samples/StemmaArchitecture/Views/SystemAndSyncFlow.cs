using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// Perspective 1 — runtime. The actors, the deployable units (the React SPA and the ASP.NET host),
/// the StemmaEngine facade, and every neighbouring system, wired by the four documented flows:
/// the write path (gesture → operation → DocumentEditor rewrite → delta), the load path
/// (open → Roslyn parse → snapshot), the presentation path (debounced PUT → stemma.layout.json →
/// prime), and the AI path (prompt → LLM service → proposed operations). "How an edit travels."
/// </summary>
public static class SystemAndSyncFlow
{
    public static View Define() => new(
        Id: "view_sync",
        Name: "System & Sync Flow",
        BaseView: "moduleMap",
        ElementIds: new[]
        {
            "per_architect", "per_agent", "per_reviewer",
            "sys_git", "sys_browser", "sys_roslyn", "sys_llm", "sys_vite",
            "cnt_client", "cnt_web", "mod_stemmaengine",
        });
}
