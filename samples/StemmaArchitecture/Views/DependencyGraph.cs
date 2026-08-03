using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// Perspective 3 — build / call time. The module reference graph, drawn with the dependency-graph
/// lens (topological layers, fan-in / fan-out). The lens renders modules, so this is the
/// library-to-library "uses / calls" graph across the four layers — and it makes the inviolable
/// purity boundary visible: the Engine modules point inward to the Model (mod_concepts / mod_modelof)
/// and to each other, the Web and Client modules point inward to the Engine, but <b>no</b> Engine
/// module ever points out to a Web, LLM, or Client module. "What depends on what."
/// </summary>
public static class DependencyGraph
{
    public static View Define() => new(
        Id: "view_deps",
        Name: "Dependency Graph",
        BaseView: "dependencyGraph",
        ElementIds: new[]
        {
            "mod_concepts", "mod_modelof",
            "mod_stemmaengine", "mod_dslreader", "mod_dslwriter", "mod_archops", "mod_viewsadapter",
            "mod_operations", "mod_undo", "mod_sidecar", "mod_validation",
            "mod_rest", "mod_hub", "mod_llmservice",
            "mod_store", "mod_layoutcache", "mod_canvas", "mod_inspector", "mod_autolayout",
            "mod_richtext", "mod_signalrclient", "mod_apiclient",
            "mod_fidelity",
        });
}
