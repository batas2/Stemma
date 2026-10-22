using Stemma.Model;

namespace FoodDelivery;

/// <summary>
/// Dishwise — a fictional food-delivery platform, and the sample for C4 views, views by rule and
/// architecture rules (F-023, F-024). It is the workspace the agent audit built by hand
/// (agent-architecture-workflow.md §1), written the way the Claude Code plugin now writes one: every
/// person, system and container described, every container and flow with its technology, declared in
/// reading order — people, front ends, the edge, services, data, then the neighbours — because the
/// layered layout breaks ties by declaration order.
///
/// No view lists its members and no box has a coordinate: the views are a scope and rules, and the
/// pictures are laid out for you.
/// </summary>
public static class Architecture
{
    public static Model Build()
    {
        // --- People ---------------------------------------------------------------------------------
        var customer = new Person("per_customer", "Customer", "external", Description: "Orders food from local restaurants");
        var courier = new Person("per_courier", "Courier", "external", Description: "Collects orders and delivers them");
        var restaurant = new Person("per_restaurant", "Restaurant Staff", "external", Description: "Accepts orders and marks them ready");

        // --- The platform and its containers --------------------------------------------------------
        var platform = new SoftwareSystem("sys_platform", "Dishwise Platform", Description: "Takes orders, dispatches couriers, settles payments");

        var customerApp = new Container("cnt_customer_app", "Customer App", "sys_platform", "mobile", Technology: "React Native", Description: "Browse, order, track the courier");
        var courierApp = new Container("cnt_courier_app", "Courier App", "sys_platform", "mobile", Technology: "Kotlin", Description: "Job offers, navigation, proof of delivery");
        var portal = new Container("cnt_portal", "Restaurant Portal", "sys_platform", "spa", Technology: "React", Description: "Incoming orders and the menu");
        var gateway = new Container("cnt_gateway", "API Gateway", "sys_platform", "gateway", Technology: "Envoy", Description: "Authenticates and routes every client call");
        var orders = new Container("cnt_orders", "Order Service", "sys_platform", "service", Technology: ".NET 8", Description: "Accepts orders and owns their state");
        var dispatch = new Container("cnt_dispatch", "Dispatch Service", "sys_platform", "service", Technology: "Go", Description: "Matches orders to couriers and tracks them");
        var payments = new Container("cnt_payments", "Payment Service", "sys_platform", "service", Technology: ".NET 8", Description: "Charges, refunds and restaurant payouts");
        var notify = new Container("cnt_notify", "Notification Worker", "sys_platform", "worker", Technology: "Node.js", Description: "Turns order events into push messages");
        var bus = new Container("cnt_bus", "Event Bus", "sys_platform", "broker", Technology: "Kafka", Description: "Order and courier events");
        var ordersDb = new Container("cnt_orders_db", "Orders DB", "sys_platform", "db", Technology: "PostgreSQL", Description: "Orders and their history");
        var dispatchDb = new Container("cnt_dispatch_db", "Dispatch DB", "sys_platform", "db", Technology: "PostgreSQL + PostGIS", Description: "Assignments and courier positions");

        // --- Neighbours -----------------------------------------------------------------------------
        var stripe = new SoftwareSystem("sys_stripe", "Stripe", Description: "Card payments and payouts");
        var maps = new SoftwareSystem("sys_maps", "Maps API", Description: "Routing and ETAs");
        var push = new SoftwareSystem("sys_push", "Push Provider", Description: "FCM and APNs");

        // --- What moves -----------------------------------------------------------------------------
        var browse = new DataFlow("flow_browse", "per_customer", "cnt_customer_app", "orders and tracks");
        var deliver = new DataFlow("flow_deliver", "per_courier", "cnt_courier_app", "accepts jobs");
        var cook = new DataFlow("flow_cook", "per_restaurant", "cnt_portal", "accepts orders");
        var appCalls = new DataFlow("flow_app_gw", "cnt_customer_app", "cnt_gateway", "places orders", Technology: "HTTPS/JSON");
        var courierCalls = new DataFlow("flow_courier_gw", "cnt_courier_app", "cnt_gateway", "reports position and status", Technology: "HTTPS/JSON");
        var portalCalls = new DataFlow("flow_portal_gw", "cnt_portal", "cnt_gateway", "accepts, marks ready", Technology: "HTTPS/JSON");
        var toOrders = new DataFlow("flow_gw_orders", "cnt_gateway", "cnt_orders", "order commands", Technology: "gRPC");
        var toDispatch = new DataFlow("flow_gw_dispatch", "cnt_gateway", "cnt_dispatch", "courier updates", Technology: "gRPC");
        var saveOrder = new DataFlow("flow_orders_db", "cnt_orders", "cnt_orders_db", "orders", Technology: "SQL");
        var charge = new DataFlow("flow_orders_pay", "cnt_orders", "cnt_payments", "charge requests", Technology: "gRPC");
        var placed = new DataFlow("flow_orders_bus", "cnt_orders", "cnt_bus", "OrderPlaced, OrderReady", Technology: "Kafka");
        // A consumer reads from the bus, so the arrow starts at the consumer, as a service's reads from
        // its database do: the bus pushes nothing up to the services (rule_layers).
        var assign = new DataFlow("flow_dispatch_bus", "cnt_dispatch", "cnt_bus", "consumes OrderReady", Technology: "Kafka");
        var tell = new DataFlow("flow_notify_bus", "cnt_notify", "cnt_bus", "consumes order and courier events", Technology: "Kafka");
        var track = new DataFlow("flow_dispatch_db", "cnt_dispatch", "cnt_dispatch_db", "assignments, positions", Technology: "SQL");
        var eta = new DataFlow("flow_dispatch_maps", "cnt_dispatch", "sys_maps", "routes and ETAs", Technology: "HTTPS");
        var card = new DataFlow("flow_pay_stripe", "cnt_payments", "sys_stripe", "charges and payouts", "twoway", Technology: "HTTPS");
        var send = new DataFlow("flow_notify_push", "cnt_notify", "sys_push", "push messages", Technology: "HTTPS");

        Tag.For(dispatch, lifecycle: new Lifecycle(Status: "to-be-created", Phase: "Q1 2027"), ownership: new Ownership(Squad: "Logistics"));
        Tag.For(orders, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Ordering"));
        Tag.For(payments, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Payments"));

        return Model.Of(customer, courier, restaurant, platform,
            customerApp, courierApp, portal, gateway, orders, dispatch, payments, notify, bus, ordersDb, dispatchDb,
            stripe, maps, push,
            browse, deliver, cook, appCalls, courierCalls, portalCalls, toOrders, toDispatch, saveOrder, charge,
            placed, assign, tell, track, eta, card, send);
    }
}
