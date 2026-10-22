using Stemma.Model;

namespace StemmaArchitecture;

/// <summary>
/// Where this model's code is: Stemma's own projects, two folders up (ADR-0029, F-025).
///
/// `stemma validate` compares the project references of what is mapped here with the data flows and
/// dependencies the model declares, so a reference the picture does not show is a warning rather than
/// a diagram that quietly says less than the code. That is the claim in Architecture.cs made
/// checkable: every element describes code in this repository.
///
/// The canvas is not mapped — it is a TypeScript project, and conformance reads .NET projects — and
/// neither are the test projects or the samples, which `validate` lists as unmapped: they are not
/// part of what ships. The engine's modules share one project, so it is mapped to the façade that
/// stands for them, and Stemma.Model to the vocabulary it mostly is.
/// </summary>
public static class Implementation
{
    public static RuleSet Define() => RuleSet.Of(
        Code.At("../.."),

        Code.Map("cnt_web", "src/Stemma.Web"),
        Code.Map("cnt_cli", "src/Stemma.Cli"),
        Code.Map("cnt_desktop", "src/Stemma.Desktop"),
        Code.Map("mod_engine", "src/Stemma.Engine/Stemma.Engine.csproj"),
        Code.Map("mod_concepts", "src/Stemma.Model/Stemma.Model.csproj"));
}
