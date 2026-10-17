using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// The three rules that override any argument, and what enforces each one.
///
/// These are Concepts rather than Modules on purpose. A rule does not ship, has no owner in the
/// deployment sense and cannot be depended on. It is a claim about how we work, so it gets the
/// element kind that asserts nothing about the system, and Relation arrows that carry a label and
/// nothing else.
///
/// This view knowingly trips `view/mixed-register`, and that is the demonstration. The check is
/// right that mixing rules with the things that ship is usually a mistake; here it is the entire
/// point, because a rule with nothing enforcing it is a poster. A warning you can explain is more
/// useful in a sample than a warning you avoided by drawing something duller.
/// </summary>
public static class Principles
{
    public static View Define() => new(
        Id: "view_principles",
        Name: "Three rules that win arguments",
        BaseView: "all",
        ElementIds: new[]
        {
            "con_fidelity",
            "con_onestore",
            "con_purity",
            "mod_fidelity",
            "sys_git",
            "mod_engine",
        });
}
