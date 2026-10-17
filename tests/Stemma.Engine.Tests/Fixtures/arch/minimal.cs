using Stemma.Model;

namespace Fixture;

public static class Architecture
{
    public static Model Build()
    {
        var ctxOrdering = new BoundedContext("ctx_ordering", "Ordering");
        var ctxBilling = new BoundedContext("ctx_billing", "Billing");
        var modCheckout = new Module("mod_checkout", "Checkout", "ctx_ordering");
        var modInvoicing = new Module("mod_invoicing", "Invoicing");
        var riskLatency = new Risk("risk_latency", "Checkout is slow");
        var flowOrders = new DataFlow("flow_orders", "mod_checkout", "mod_invoicing", "Order");
        Tag.For(modCheckout, lifecycle: new Lifecycle(Status: "current"));

        return Model.Of(ctxOrdering, ctxBilling, modCheckout, modInvoicing, riskLatency, flowOrders);
    }
}
