using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// The engine's reference graph, on the lens that lays out by fan-in and fan-out. The facade sits
/// at the top and everything below it is a leaf. Roslyn and the record vocabulary are the only two
/// things it is allowed to know about, which is the whole of the purity rule expressed as a shape.
///
/// Modules only, and that is not a stylistic choice. The `dependencyGraph` lens draws modules,
/// bounded contexts and capabilities and silently drops everything else, so an earlier version of
/// this view listed Roslyn and rendered six boxes out of seven with no warning. If a box you asked
/// for is missing, check the lens before you check your ids.
/// </summary>
public static class EngineDependencies
{
    public static View Define() => new(
        Id: "view_deps",
        Name: "What the engine is allowed to know",
        BaseView: "dependencyGraph",
        ElementIds: new[]
        {
            "mod_engine",
            "mod_reader",
            "mod_writer",
            "mod_ops",
            "mod_sidecar",
            "mod_rules",
            "mod_concepts",
        });
}
