using Stemma.Model;

namespace AuroraRail;

/// <summary>
/// Perspective 3 — build / call time, drawn with the dependency-graph lens (topological layers,
/// fan-in / fan-out). The lens renders modules, so containers and neighbouring systems drop out and
/// what is left is the library graph. It shows the intended shape of the platform: Sales depends on
/// Fares, Fulfilment depends on Sales, Revenue depends on Sales — and nothing depends on Care.
/// "What depends on what."
/// </summary>
public static class PlatformDependencies
{
    public static View Define() => new(
        Id: "view_deps",
        Name: "Platform Dependencies",
        BaseView: "dependencyGraph",
        ElementIds: new[]
        {
            "mod_timetable", "mod_planner", "mod_live",
            "mod_fare_import", "mod_fare_rules", "mod_railcards", "mod_quote",
            "mod_basket", "mod_checkout", "mod_payments", "mod_orders",
            "mod_issuing", "mod_barcode", "mod_wallet", "mod_gateline",
            "mod_disruption", "mod_delay_repay", "mod_refunds",
            "mod_apportion", "mod_settlement", "mod_reporting",
        });
}
