using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// Perspective 2 — structure &amp; ownership. The five layer Bounded Contexts (Client, Web, Engine,
/// Model, Quality) with their Modules and Capabilities, the user-visible use cases, and the open
/// Risks / Questions / Assumptions (dotted "about" links to the element each concerns — the
/// fidelity contract, the no-parallel-store rule, prime-the-sidecar-once, engine purity). Lifecycle
/// and ownership tags render as badges. "How the code is organised, who owns it, what is still open."
/// </summary>
public static class CodeAndOwnership
{
    public static View Define() => new(
        Id: "view_code",
        Name: "Code & Ownership",
        BaseView: "moduleMap",
        ElementIds: new[]
        {
            "ctx_client", "ctx_web", "ctx_engine", "ctx_model", "ctx_quality",
            "mod_concepts", "mod_modelof",
            "mod_stemmaengine", "mod_dslreader", "mod_dslwriter", "mod_archops", "mod_viewsadapter",
            "mod_operations", "mod_undo", "mod_sidecar", "mod_validation",
            "mod_rest", "mod_hub", "mod_llmservice",
            "mod_store", "mod_layoutcache", "mod_canvas", "mod_inspector", "mod_autolayout",
            "mod_richtext", "mod_signalrclient", "mod_apiclient",
            "mod_fidelity",
            "cap_load", "cap_apply", "cap_fidelity", "cap_render", "cap_edit", "cap_sync", "cap_layout", "cap_ai",
            "uc_edit", "uc_review",
            "risk_fidelity", "risk_normalize", "risk_parallelstore", "risk_refetch", "risk_dangling",
            "risk_dragrebuild", "risk_purity",
            "q_methodbody", "q_conflict", "q_opcatalog",
            "asm_git", "asm_modelcode", "asm_primeonce", "asm_purity",
        });
}
