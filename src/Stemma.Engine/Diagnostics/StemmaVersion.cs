using System.Reflection;

namespace Stemma.Engine.Diagnostics;

/// <summary>
/// Which Stemma this is. Stated once, as <c>VersionPrefix</c> in <c>Directory.Build.props</c>, and
/// stamped into every assembly of the build, so the CLI, the shell and the host cannot disagree
/// (F-012).
/// </summary>
public static class StemmaVersion
{
    /// <summary>The build: the release and the commit it was built from, <c>0.1.0+cdb8e26…</c>.
    /// What a bug report needs.</summary>
    public static string Build { get; } =
        typeof(StemmaVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? "0.0.0";

    /// <summary>The release, <c>0.1.0</c>: what <c>--version</c> prints and a release tag must match.</summary>
    public static string Release { get; } = Build.Split('+')[0];
}
