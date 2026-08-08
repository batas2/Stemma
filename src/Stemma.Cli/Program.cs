using Stemma.Cli;

// `stemma` — the headless half of Stemma. Everything here exists so that turning a model into a
// picture needs no browser of your own open and no mouse.

if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
{
    Console.WriteLine(Cli.RootUsage);
    return 0;
}

var command = args[0];
var rest = args.Skip(1).ToArray();

try
{
    return command switch
    {
        "render" => await RenderCommand.RunAsync(rest),
        "validate" => await ValidateCommand.RunAsync(rest),
        _ => Cli.Fail($"unknown command '{command}'"),
    };
}
catch (Exception ex)
{
    Console.Error.WriteLine($"stemma {command}: {ex.Message}");
    return 1;
}

namespace Stemma.Cli
{
    internal static class Cli
    {
        public const string RootUsage = """
            stemma — headless tools for a Stemma workspace.

              stemma render    Turn a model and a view into an image.
              stemma validate  Check a workspace for the things the compiler cannot see.

            Run a command with --help for its options.
            """;

        public static int Fail(string message)
        {
            Console.Error.WriteLine($"stemma: {message}");
            Console.Error.WriteLine();
            Console.Error.WriteLine(RootUsage);
            return 2;
        }
    }
}
