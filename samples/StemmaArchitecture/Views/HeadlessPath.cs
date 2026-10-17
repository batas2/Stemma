using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// The half with no person in it. An agent writes three files by hand, runs one command, and gets
/// an image plus a manifest that lets a build notice when the picture stopped matching the model.
/// The CLI starts its own short-lived host, which is why two renders never fight.
/// </summary>
public static class HeadlessPath
{
    public static View Define() => new(
        Id: "view_headless",
        Name: "A diagram with no mouse",
        BaseView: "all",
        ElementIds: new[]
        {
            "per_agent",
            "cnt_cli",
            "mod_render",
            "sys_chromium",
            "mod_manifest",
            "sys_git",
        });
}
