using Stemma.Model;

namespace AuroraRail;

/// <summary>
/// Perspective 2 — the migration. Only what still touches RESERVA, plus what replaces it. Read it
/// with the lifecycle badges on: `deprecated` is what dies with the mainframe, `to-adapt` is the
/// bridge code written to be deleted, `to-be-created` is the revenue work that cannot start until
/// apportionment has an owner. "What is left of the mainframe."
/// </summary>
public static class StranglerMigration
{
    public static View Define() => new(
        Id: "view_strangler",
        Name: "Strangler Migration",
        BaseView: "moduleMap",
        ElementIds: new[]
        {
            "sys_reserva", "sys_fares", "cnt_store", "cnt_gatesync",
            "ctx_fares", "mod_fare_import", "mod_fare_rules",
            "ctx_sales", "mod_checkout", "mod_orders",
            "ctx_fulfilment", "mod_gateline",
            "ctx_revenue", "mod_apportion", "mod_settlement", "mod_reporting",
            "risk_fare_drift", "risk_batch_window", "q_apportion_owner", "asm_gate_latency",
        });
}
