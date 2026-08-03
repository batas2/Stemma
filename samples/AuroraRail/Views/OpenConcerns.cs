using Stemma.Model;

namespace AuroraRail;

/// <summary>
/// Perspective 4 — what the team is worried about. Every Risk, Question and Assumption together
/// with the element it hangs off, so the dotted "about" edges cluster each concern next to the
/// thing it concerns. This is the view to open before a design review, and the one to screenshot
/// when someone asks why the RESERVA retirement date keeps moving. "What is still open."
/// </summary>
public static class OpenConcerns
{
    public static View Define() => new(
        Id: "view_concerns",
        Name: "Open Concerns",
        BaseView: "all",
        ElementIds: new[]
        {
            "risk_fare_drift", "risk_barcode_replay", "risk_strike_load", "risk_batch_window",
            "q_railcard_owner", "q_apportion_owner", "q_wallet_offline",
            "asm_fare_daily", "asm_opendata", "asm_gate_latency",
            "mod_fare_rules", "mod_fare_import", "mod_railcards", "mod_barcode", "mod_wallet",
            "mod_refunds", "mod_disruption", "mod_gateline", "mod_apportion", "sys_reserva",
        });
}
