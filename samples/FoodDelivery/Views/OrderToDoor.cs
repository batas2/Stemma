using Stemma.Model;

namespace FoodDelivery;

/// <summary>
/// One flow, by rule: everything an order touches on its way to the door. The order service and its
/// neighbours, the dispatch path, and none of the notification side.
/// </summary>
public static class OrderToDoor
{
    public static View Define() => new(
        Id: "view_order_to_door",
        Name: "From order to door",
        BaseView: "all",
        Include: ["per_customer", "cnt_customer_app", "cnt_gateway", "->cnt_orders->", "->cnt_dispatch->"],
        Exclude: ["cnt_notify", "sys_push"]);
}
