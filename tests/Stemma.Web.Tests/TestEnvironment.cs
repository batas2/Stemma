using System.Runtime.CompilerServices;

namespace Stemma.Web.Tests;

internal static class TestEnvironment
{
    /// <summary>
    /// Every host these tests start opens a workspace in a temporary folder. Remembered, each one
    /// went into the recent list of whoever ran the tests, ahead of the models they actually use.
    /// </summary>
    [ModuleInitializer]
    internal static void KeepOutOfTheRecentList() => Environment.SetEnvironmentVariable("STEMMA_RECENTS", "off");
}
