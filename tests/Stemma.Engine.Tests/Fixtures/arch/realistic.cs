// Order to cash, as the architecture guild draws it. Edited in Stemma and by hand; both are fine,
// and a diff from either should read the same.
using Stemma.Model;

namespace Fixture;

/// <summary>
/// The order-to-cash slice: where an order is taken, where it becomes an invoice, and what
/// worries us about the path between them.
/// </summary>
public static class Architecture
{
    public static Model Build()
    {
        #region Contexts
        // ── Where the work happens ───────────────────────────────────────────
        var ctxOrdering = new BoundedContext("ctx_ordering", "Ordering");
        var ctxBilling = new BoundedContext("ctx_billing", "Billing"); // split out of Ordering in 2025
        #endregion

        // ── Modules ──────────────────────────────────────────────────────────
        // Checkout is the one everybody argues about.
        var modCheckout = new Module("mod_checkout", "Checkout", "ctx_ordering"); // owned by Core
        var modInvoicing = new Module("mod_invoicing", "Invoicing");

        // ── What worries us ──────────────────────────────────────────────────
        var riskLatency = new Risk("risk_latency", "Checkout is slow");

        // ── How it connects ──────────────────────────────────────────────────
        var flowOrders = new DataFlow("flow_orders", "mod_checkout", "mod_invoicing", "Order");

        // ── Who buys, and where ──────────────────────────────────────────────
        var perBuyer = new Person("per_buyer", "Buyer", "external"); // anyone with a basket
        var sysShop = new SoftwareSystem("sys_shop", "Shop");
        var cntWeb = new Container("cnt_web", "Web Shop", "sys_shop", "spa"); // the storefront
        // Its kind is left to the default: it is a service until someone says otherwise.
        var cntStore = new Container("cnt_store", "Order Store", "sys_shop");
        var flowBrowse = new DataFlow("flow_browse", "per_buyer", "cnt_web",
            "search terms", "twoway");

        // ── Lifecycle and ownership ──────────────────────────────────────────
        // RAPID on the one decision that actually gets argued about.
        Tag.For(modCheckout,
            lifecycle: new Lifecycle(Status: "current", Phase: "fidelity-critical"),
            ownership: new Ownership(Squad: "Core", Domain: "Ordering",
                Recommend: ["Core"], Agree: ["QA"], Decide: ["Architect"]));

        return Model.Of(
            perBuyer, sysShop, cntWeb, cntStore, flowBrowse,
            ctxOrdering, ctxBilling,
            modCheckout, modInvoicing,
            riskLatency,
            flowOrders);
    }
}
