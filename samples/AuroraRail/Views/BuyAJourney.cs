using Stemma.Model;

namespace AuroraRail;

/// <summary>
/// Perspective 1 — the money path. Everything a passenger touches between "where am I going?" and
/// "the ticket is in my wallet": quote, basket, checkout, payment, event, issuing, barcode,
/// delivery. The legacy seat hold is deliberately included so the one remaining RESERVA call on
/// the happy path stays visible. "How a ticket is sold."
/// </summary>
public static class BuyAJourney
{
    public static View Define() => new(
        Id: "view_buy",
        Name: "Buy a Journey",
        BaseView: "moduleMap",
        ElementIds: new[]
        {
            "per_passenger", "uc_buy",
            "cnt_app", "cnt_api", "cnt_bus",
            "ctx_journey", "mod_planner",
            "ctx_fares", "cap_price", "mod_quote", "mod_fare_rules", "mod_railcards",
            "ctx_sales", "cap_sell", "mod_basket", "mod_checkout", "mod_payments", "mod_orders",
            "ctx_fulfilment", "cap_fulfil", "mod_issuing", "mod_barcode", "mod_wallet",
            "sys_payments", "sys_notify", "sys_reserva",
        });
}
