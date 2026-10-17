using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// What ships, and the two things it cannot do without. Four deployables, and Git and Roslyn
/// underneath them. Deliberately the smallest view in the workspace: if somebody has thirty
/// seconds, this is the one to show them.
/// </summary>
public static class Shape
{
    public static View Define() => new(
        Id: "view_shape",
        Name: "What ships",
        BaseView: "all",
        ElementIds: new[]
        {
            "cnt_client", "cnt_web", "cnt_cli", "cnt_desktop",
            "sys_git", "sys_roslyn",
        });
}
