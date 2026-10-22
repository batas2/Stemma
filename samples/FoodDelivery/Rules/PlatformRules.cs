using Stemma.Model;

namespace FoodDelivery;

/// <summary>What Dishwise must keep true, each with the reason a reviewer would give.</summary>
public static class PlatformRules
{
    public static RuleSet Define() => RuleSet.Of(
        Rule.Use("c4"),

        Rule.Only("rule_card_data", from: "cnt_payments", to: "sys_stripe",
            because: "Card data stays inside one service, which keeps PCI scope to one team"),

        Rule.Forbid("rule_clients_via_gateway", from: "kind:container[kind=mobile|spa]", to: "kind:container[kind=service|db|broker]",
            because: "Every client call is authenticated at the gateway"),

        Rule.Forbid("rule_own_data", from: "kind:container[kind=service]", to: "kind:container[kind=db]",
            via: "dependency",
            because: "A service reaches another service's data through its API, never its schema"),

        Rule.Layers("rule_layers",
            ["kind:person", "kind:container[kind=mobile|spa]", "kind:container[kind=gateway]",
             "kind:container[kind=service|worker]", "kind:container[kind=db|broker]"],
            because: "Requests flow down: people, clients, the edge, services, data"),

        Rule.Require("rule_owned", of: "kind:container[kind=service]", has: "squad", severity: "warning",
            because: "Every service has a squad that is paged for it"));
}
