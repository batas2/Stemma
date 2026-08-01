namespace Stemma.Engine.Adapters;

/// <summary>
/// Marker interface for Stemma's storage adapters. The three v1 implementations are:
/// the Roslyn adapter (`Architecture/*.cs` via <c>DocumentEditor</c>), the Markdown
/// adapter (`Decisions/`, `Capabilities/`), and the YAML adapter (`Concepts/*.stemma.yaml`).
///
/// Adapters are not yet polymorphic at the call site — each is invoked directly by the
/// engine — but this interface pins the contract every adapter MUST honour, per ADR-0011:
///
///  - Round-trip fidelity: a load + immediate save with no mutation must be byte-identical.
///  - No string-emit of the canonical format anywhere outside the adapter's writer.
///  - Stable concept ids that survive renames.
///
/// Future iterations can dispatch through this interface; the current engine wiring stays
/// direct because the three formats have very different mutation primitives.
/// </summary>
public interface IStorageAdapter
{
    /// <summary>Human-readable adapter name (used in diagnostics and violations).</summary>
    string Name { get; }
}
