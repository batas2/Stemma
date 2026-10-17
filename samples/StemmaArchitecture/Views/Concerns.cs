using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// Everything I am not sure about, anchored to the thing it is about. Risks are the failure modes
/// I have already met at least once; the questions are open and the assumptions are what the rest
/// of the model quietly rests on. Two of these risks became real bugs in August and are fixed.
/// </summary>
public static class Concerns
{
    public static View Define() => new(
        Id: "view_concerns",
        Name: "What I am not sure about",
        BaseView: "all",
        ElementIds: new[]
        {
            "risk_trivia",
            "q_conflict",
            "asm_sourceismodel",
            "mod_writer",
            "mod_hub",
            "mod_concepts",
        });
}
