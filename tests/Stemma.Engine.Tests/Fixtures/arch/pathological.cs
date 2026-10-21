// Pathological on purpose: a BOM, tabs, CRLF in the body and LF in the header, block
// comments inside argument lists, named arguments, a verbatim string, trailing whitespace
// and a preprocessor block. Every byte outside an operation's target has to survive it.
using Stemma.Model;
namespace Fixture;

public static class Architecture { public static Model Build() {
	var ctxOrdering = new BoundedContext("ctx_ordering", /* once called Sales */ "Ordering");
	var ctxBilling = new BoundedContext(@"ctx_billing", "Billing");   
#if DEBUG
	// demo scaffolding, compiled out of release builds
#endif
	var modCheckout = new Module(
		"mod_checkout",
		"Checkout", // the name people actually use
		"ctx_ordering"
	);
	var modInvoicing = new Module(Id: "mod_invoicing", Name: "Invoicing");
	/* the slow path */ var riskLatency = new Risk("risk_latency", "Checkout is slow");
	var flowOrders = new DataFlow("flow_orders", "mod_checkout", "mod_invoicing", "Order");/* hot */
	Tag.For(modCheckout, lifecycle: new Lifecycle("current", "fidelity-critical"));
	return Model.Of(ctxOrdering, /* contexts first */ ctxBilling,
		modCheckout, modInvoicing, riskLatency, flowOrders);
}}
