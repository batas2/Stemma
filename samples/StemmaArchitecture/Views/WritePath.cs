using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// The claim, end to end: a gesture on a canvas comes out as a line in a diff. Seven boxes,
/// one direction, and no database anywhere in it. If this path is wrong, nothing else matters.
/// </summary>
public static class WritePath
{
    public static View Define() => new(
        Id: "view_write",
        Name: "From gesture to diff",
        BaseView: "all",
        ElementIds: new[]
        {
            "per_architect",
            "cnt_client",
            "mod_hub",
            "mod_engine",
            "mod_writer",
            "sys_roslyn",
            "sys_git",
        });
}
