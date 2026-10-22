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
        var perBuyer = new Person("per_buyer", "Buyer", "external");
        var sysShop = new SoftwareSystem("sys_shop", "Shop");
        var cntWeb = new Container("cnt_web", "Web Shop", "sys_shop", "spa");
        var cntStore = new Container("cnt_store", "Order Store", "sys_shop");
        var flowBrowse = new DataFlow("flow_browse", "per_buyer", "cnt_web", "search terms", "twoway");
        Tag.For(modCheckout, lifecycle: new Lifecycle(Status: "current"));

        return Model.Of(perBuyer, sysShop, cntWeb, cntStore, flowBrowse, ctxOrdering, ctxBilling, modCheckout, modInvoicing, riskLatency, flowOrders);
    }
}
