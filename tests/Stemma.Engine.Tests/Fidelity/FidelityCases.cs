using Stemma.Engine.ArchModel;
using Stemma.Engine.Operations;

namespace Stemma.Engine.Tests.Fidelity;

/// <summary>
/// One operation applied to one fixture, and every edit it is allowed to make — nothing else in the
/// file may change. The three fixtures describe the same model in three hands (see
/// <c>Fixtures/arch/</c>), so the same operations run against each and only the expected text
/// differs. The catalog in <c>.doc/architecture/engine-backend.md</c> is the specification these
/// encode.
/// </summary>
public sealed record FidelityCase(string Name, OperationBase Op, IReadOnlyList<(string From, string To)> Edits);

public static class FidelityCases
{
    private const string Op = "op";

    private static FidelityCase Case(string name, OperationBase op, params (string From, string To)[] edits) => new(name, op, edits);

    public static readonly IReadOnlyDictionary<string, IReadOnlyList<FidelityCase>> All = new Dictionary<string, IReadOnlyList<FidelityCase>>
    {
        ["minimal"] = Minimal(),
        ["realistic"] = Realistic(),
        ["pathological"] = Pathological(),
    };

    public static FidelityCase Find(string fixture, string name) => All[fixture].Single(c => c.Name == name);

    // ── minimal ──────────────────────────────────────────────────────────────────────────────
    private static IReadOnlyList<FidelityCase> Minimal()
    {
        const string tag = "        Tag.For(modCheckout, lifecycle: new Lifecycle(Status: \"current\"));\n";
        const string ret = "riskLatency, flowOrders);";
        return
        [
            Case("AddElement", new AddElementOp(Op, ArchElementKind.Module, "Pricing", ContextId: "ctx_billing"),
                (tag, tag + "        var mod001 = new Module(\"mod_001\", \"Pricing\", \"ctx_billing\");\n"),
                (ret, "riskLatency, flowOrders, mod001);")),
            Case("AddLink", new AddLinkOp(Op, ArchLinkKind.Dependency, "mod_invoicing", "mod_checkout", DependencyKind: "calls"),
                (tag, tag + "        var dep001 = new Dependency(\"dep_001\", \"mod_invoicing\", \"mod_checkout\", \"calls\");\n"),
                (ret, "riskLatency, flowOrders, dep001);")),
            Case("RenameElement", new RenameElementOp(Op, "mod_checkout", "Basket"),
                ("var modCheckout = new Module(\"mod_checkout\", \"Checkout\",", "var modBasket = new Module(\"mod_checkout\", \"Basket\","),
                ("Tag.For(modCheckout,", "Tag.For(modBasket,"),
                ("ctxBilling, modCheckout, modInvoicing", "ctxBilling, modBasket, modInvoicing")),
            Case("RemoveElement.tagged", new RemoveElementOp(Op, "mod_checkout"),
                ("        var modCheckout = new Module(\"mod_checkout\", \"Checkout\", \"ctx_ordering\");\n", ""),
                (tag, ""),
                ("ctxBilling, modCheckout, modInvoicing", "ctxBilling, modInvoicing")),
            Case("RemoveElement.untagged", new RemoveElementOp(Op, "risk_latency"),
                ("        var riskLatency = new Risk(\"risk_latency\", \"Checkout is slow\");\n", ""),
                ("modInvoicing, riskLatency, flowOrders", "modInvoicing, flowOrders")),
            Case("RemoveLink", new RemoveLinkOp(Op, "flow_orders"),
                ("        var flowOrders = new DataFlow(\"flow_orders\", \"mod_checkout\", \"mod_invoicing\", \"Order\");\n", ""),
                (ret, "riskLatency);")),
            Case("SetElementContext.replace", new SetElementContextOp(Op, "mod_checkout", "ctx_billing"),
                ("\"Checkout\", \"ctx_ordering\")", "\"Checkout\", \"ctx_billing\")")),
            Case("SetElementContext.add", new SetElementContextOp(Op, "mod_invoicing", "ctx_billing"),
                ("new Module(\"mod_invoicing\", \"Invoicing\")", "new Module(\"mod_invoicing\", \"Invoicing\", \"ctx_billing\")")),
            Case("SetElementContext.clear", new SetElementContextOp(Op, "mod_checkout", null),
                ("\"Checkout\", \"ctx_ordering\")", "\"Checkout\")")),
            Case("SetElementAttribute.add", new SetElementAttributeOp(Op, "risk_latency", "aboutId", "mod_checkout"),
                ("\"Checkout is slow\")", "\"Checkout is slow\", \"mod_checkout\")")),
            Case("SetLinkAttribute.replace", new SetLinkAttributeOp(Op, "flow_orders", "payload", "Invoice"),
                ("\"mod_invoicing\", \"Order\")", "\"mod_invoicing\", \"Invoice\")")),
            Case("SetLinkAttribute.add", new SetLinkAttributeOp(Op, "flow_orders", "direction", "twoway"),
                ("\"mod_invoicing\", \"Order\")", "\"mod_invoicing\", \"Order\", \"twoway\")")),
            Case("SetLifecycle.replace", new SetLifecycleOp(Op, "mod_checkout", "target", null, null, null),
                ("Status: \"current\"", "Status: \"target\"")),
            Case("SetLifecycle.insert", new SetLifecycleOp(Op, "mod_invoicing", "current", null, null, null),
                ("        var modInvoicing = new Module(\"mod_invoicing\", \"Invoicing\");\n",
                 "        var modInvoicing = new Module(\"mod_invoicing\", \"Invoicing\");\n        Tag.For(modInvoicing, lifecycle: new Lifecycle(Status: \"current\"));\n")),
            Case("SetLifecycle.clear", new SetLifecycleOp(Op, "mod_checkout", null, null, null, null),
                (tag, "")),
            Case("SetOwnership.add", new SetOwnershipOp(Op, "mod_checkout", "Payments", "Ordering"),
                ("new Lifecycle(Status: \"current\"));", "new Lifecycle(Status: \"current\"), ownership: new Ownership(Squad: \"Payments\", Domain: \"Ordering\"));")),
        ];
    }

    // ── realistic ────────────────────────────────────────────────────────────────────────────
    private static IReadOnlyList<FidelityCase> Realistic()
    {
        const string tagEnd = "                Recommend: [\"Core\"], Agree: [\"QA\"], Decide: [\"Architect\"]));\n";
        const string tag =
            "        Tag.For(modCheckout,\n" +
            "            lifecycle: new Lifecycle(Status: \"current\", Phase: \"fidelity-critical\"),\n" +
            "            ownership: new Ownership(Squad: \"Core\", Domain: \"Ordering\",\n" +
            tagEnd;
        const string retEnd = "            flowOrders);";
        return
        [
            Case("AddElement", new AddElementOp(Op, ArchElementKind.Module, "Pricing", ContextId: "ctx_billing"),
                (tagEnd, tagEnd + "        var mod001 = new Module(\"mod_001\", \"Pricing\", \"ctx_billing\");\n"),
                (retEnd, "            flowOrders,\n            mod001);")),
            Case("AddLink", new AddLinkOp(Op, ArchLinkKind.Dependency, "mod_invoicing", "mod_checkout", DependencyKind: "calls"),
                (tagEnd, tagEnd + "        var dep001 = new Dependency(\"dep_001\", \"mod_invoicing\", \"mod_checkout\", \"calls\");\n"),
                (retEnd, "            flowOrders,\n            dep001);")),
            Case("RenameElement", new RenameElementOp(Op, "mod_checkout", "Basket"),
                ("var modCheckout = new Module(\"mod_checkout\", \"Checkout\",", "var modBasket = new Module(\"mod_checkout\", \"Basket\","),
                ("Tag.For(modCheckout,", "Tag.For(modBasket,"),
                ("            modCheckout, modInvoicing,", "            modBasket, modInvoicing,")),
            Case("RemoveElement.tagged", new RemoveElementOp(Op, "mod_checkout"),
                // The comments above the declaration and above the tag stay: Stemma cannot tell a
                // note about this element from the header of the section it sits in.
                ("        var modCheckout = new Module(\"mod_checkout\", \"Checkout\", \"ctx_ordering\"); // owned by Core\n", ""),
                (tag, ""),
                ("            modCheckout, modInvoicing,", "            modInvoicing,")),
            Case("RemoveElement.untagged", new RemoveElementOp(Op, "risk_latency"),
                ("        var riskLatency = new Risk(\"risk_latency\", \"Checkout is slow\");\n", ""),
                ("            riskLatency,\n", "")),
            Case("RemoveLink", new RemoveLinkOp(Op, "flow_orders"),
                ("        var flowOrders = new DataFlow(\"flow_orders\", \"mod_checkout\", \"mod_invoicing\", \"Order\");\n", ""),
                ("            riskLatency,\n            flowOrders);", "            riskLatency);")),
            Case("SetElementContext.replace", new SetElementContextOp(Op, "mod_checkout", "ctx_billing"),
                ("\"Checkout\", \"ctx_ordering\"); // owned by Core", "\"Checkout\", \"ctx_billing\"); // owned by Core")),
            Case("SetElementContext.add", new SetElementContextOp(Op, "mod_invoicing", "ctx_billing"),
                ("new Module(\"mod_invoicing\", \"Invoicing\")", "new Module(\"mod_invoicing\", \"Invoicing\", \"ctx_billing\")")),
            Case("SetElementContext.clear", new SetElementContextOp(Op, "mod_checkout", null),
                ("\"Checkout\", \"ctx_ordering\"); // owned by Core", "\"Checkout\"); // owned by Core")),
            Case("SetElementAttribute.add", new SetElementAttributeOp(Op, "risk_latency", "aboutId", "mod_checkout"),
                ("\"Checkout is slow\")", "\"Checkout is slow\", \"mod_checkout\")")),
            Case("SetLinkAttribute.replace", new SetLinkAttributeOp(Op, "flow_orders", "payload", "Invoice"),
                ("\"mod_invoicing\", \"Order\")", "\"mod_invoicing\", \"Invoice\")")),
            Case("SetLinkAttribute.add", new SetLinkAttributeOp(Op, "flow_orders", "direction", "twoway"),
                ("\"mod_invoicing\", \"Order\")", "\"mod_invoicing\", \"Order\", \"twoway\")")),
            Case("SetLifecycle.replace", new SetLifecycleOp(Op, "mod_checkout", "target", "fidelity-critical", null, null),
                ("Status: \"current\", Phase:", "Status: \"target\", Phase:")),
            Case("SetLifecycle.insert", new SetLifecycleOp(Op, "mod_invoicing", "current", null, null, null),
                ("        var modInvoicing = new Module(\"mod_invoicing\", \"Invoicing\");\n",
                 "        var modInvoicing = new Module(\"mod_invoicing\", \"Invoicing\");\n        Tag.For(modInvoicing, lifecycle: new Lifecycle(Status: \"current\"));\n")),
            Case("SetLifecycle.clear", new SetLifecycleOp(Op, "mod_checkout", null, null, null, null),
                // Ownership is still there, so the tag stays and only its lifecycle line goes.
                ("            lifecycle: new Lifecycle(Status: \"current\", Phase: \"fidelity-critical\"),\n", "")),
            Case("SetLifecycle.drop-phase", new SetLifecycleOp(Op, "mod_checkout", "current", null, null, null),
                ("Status: \"current\", Phase: \"fidelity-critical\")", "Status: \"current\")")),
            Case("SetOwnership.replace", new SetOwnershipOp(Op, "mod_checkout", "Payments", "Ordering"),
                // RAPID roles are not part of this operation, so they are not touched by it.
                ("Squad: \"Core\"", "Squad: \"Payments\"")),
            Case("SetOwnership.clear", new SetOwnershipOp(Op, "mod_checkout", null, null),
                ("new Ownership(Squad: \"Core\", Domain: \"Ordering\",\n", "new Ownership(\n")),
        ];
    }

    // ── pathological ─────────────────────────────────────────────────────────────────────────
    private static IReadOnlyList<FidelityCase> Pathological()
    {
        // Two positional fields: clearing the first writes null in its place while the second is
        // there, and nothing once both are gone.
        const string tag = "\tTag.For(modCheckout, lifecycle: new Lifecycle(\"current\", \"fidelity-critical\"));\r\n";
        const string ret = "riskLatency, flowOrders);";
        const string invoicing = "\tvar modInvoicing = new Module(Id: \"mod_invoicing\", Name: \"Invoicing\");\r\n";
        return
        [
            Case("AddElement", new AddElementOp(Op, ArchElementKind.Module, "Pricing", ContextId: "ctx_billing"),
                (tag, tag + "\tvar mod001 = new Module(\"mod_001\", \"Pricing\", \"ctx_billing\");\r\n"),
                (ret, "riskLatency, flowOrders, mod001);")),
            Case("AddLink", new AddLinkOp(Op, ArchLinkKind.Dependency, "mod_invoicing", "mod_checkout", DependencyKind: "calls"),
                (tag, tag + "\tvar dep001 = new Dependency(\"dep_001\", \"mod_invoicing\", \"mod_checkout\", \"calls\");\r\n"),
                (ret, "riskLatency, flowOrders, dep001);")),
            Case("RenameElement", new RenameElementOp(Op, "mod_checkout", "Basket"),
                ("\tvar modCheckout = new Module(", "\tvar modBasket = new Module("),
                ("\t\t\"Checkout\", // the name", "\t\t\"Basket\", // the name"),
                ("Tag.For(modCheckout,", "Tag.For(modBasket,"),
                ("\t\tmodCheckout, modInvoicing", "\t\tmodBasket, modInvoicing")),
            Case("RenameElement.named", new RenameElementOp(Op, "mod_invoicing", "Billing run"),
                (invoicing, "\tvar modBillingRun = new Module(Id: \"mod_invoicing\", Name: \"Billing run\");\r\n"),
                ("modCheckout, modInvoicing, riskLatency", "modCheckout, modBillingRun, riskLatency")),
            Case("RemoveElement.tagged", new RemoveElementOp(Op, "mod_checkout"),
                // The preprocessor block above the declaration is not part of it, and stays.
                ("\tvar modCheckout = new Module(\r\n\t\t\"mod_checkout\",\r\n\t\t\"Checkout\", // the name people actually use\r\n\t\t\"ctx_ordering\"\r\n\t);\r\n", ""),
                (tag, ""),
                ("\t\tmodCheckout, modInvoicing,", "\t\tmodInvoicing,")),
            Case("RemoveElement.untagged", new RemoveElementOp(Op, "risk_latency"),
                // The block comment shares the declaration's line, so it goes with the line.
                ("\t/* the slow path */ var riskLatency = new Risk(\"risk_latency\", \"Checkout is slow\");\r\n", ""),
                ("modInvoicing, riskLatency, flowOrders", "modInvoicing, flowOrders")),
            Case("RemoveLink", new RemoveLinkOp(Op, "flow_orders"),
                ("\tvar flowOrders = new DataFlow(\"flow_orders\", \"mod_checkout\", \"mod_invoicing\", \"Order\");/* hot */\r\n", ""),
                (ret, "riskLatency);")),
            Case("SetElementContext.replace", new SetElementContextOp(Op, "mod_checkout", "ctx_billing"),
                ("\t\t\"ctx_ordering\"\r\n", "\t\t\"ctx_billing\"\r\n")),
            Case("SetElementContext.add", new SetElementContextOp(Op, "mod_invoicing", "ctx_billing"),
                // The call already names its arguments, so the new one is named too.
                ("Name: \"Invoicing\")", "Name: \"Invoicing\", ContextId: \"ctx_billing\")")),
            Case("SetElementContext.clear", new SetElementContextOp(Op, "mod_checkout", null),
                // The comma goes; the comment after it was about the line above, and stays there.
                ("\t\t\"Checkout\", // the name people actually use\r\n\t\t\"ctx_ordering\"\r\n\t);", "\t\t\"Checkout\" // the name people actually use\r\n\t);")),
            Case("SetElementAttribute.add", new SetElementAttributeOp(Op, "risk_latency", "aboutId", "mod_checkout"),
                ("\"Checkout is slow\")", "\"Checkout is slow\", \"mod_checkout\")")),
            Case("SetLinkAttribute.replace", new SetLinkAttributeOp(Op, "flow_orders", "payload", "Invoice"),
                ("\"mod_invoicing\", \"Order\")", "\"mod_invoicing\", \"Invoice\")")),
            Case("SetLinkAttribute.add", new SetLinkAttributeOp(Op, "flow_orders", "direction", "twoway"),
                ("\"mod_invoicing\", \"Order\")", "\"mod_invoicing\", \"Order\", \"twoway\")")),
            Case("SetLifecycle.replace", new SetLifecycleOp(Op, "mod_checkout", "target", "fidelity-critical", null, null),
                ("new Lifecycle(\"current\",", "new Lifecycle(\"target\",")),
            Case("SetLifecycle.insert", new SetLifecycleOp(Op, "mod_invoicing", "current", null, null, null),
                (invoicing, invoicing + "\tTag.For(modInvoicing, lifecycle: new Lifecycle(Status: \"current\"));\r\n")),
            Case("SetLifecycle.clear", new SetLifecycleOp(Op, "mod_checkout", null, null, null, null),
                // Not new Lifecycle(null): a lifecycle with nothing in it goes, and the tag with it.
                (tag, "")),
            Case("SetLifecycle.drop-phase", new SetLifecycleOp(Op, "mod_checkout", "current", null, null, null),
                ("new Lifecycle(\"current\", \"fidelity-critical\")", "new Lifecycle(\"current\")")),
            Case("SetLifecycle.clear-status", new SetLifecycleOp(Op, "mod_checkout", null, "fidelity-critical", null, null),
                // The phase is still there and positional, so the status it follows becomes null.
                ("new Lifecycle(\"current\", \"fidelity-critical\")", "new Lifecycle(null, \"fidelity-critical\")")),
            Case("SetOwnership.add", new SetOwnershipOp(Op, "mod_checkout", "Payments", "Ordering"),
                ("\"fidelity-critical\"));", "\"fidelity-critical\"), ownership: new Ownership(Squad: \"Payments\", Domain: \"Ordering\"));")),
        ];
    }
}
