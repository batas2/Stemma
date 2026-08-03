using Stemma.Model;

namespace AuroraRail;

/// <summary>
/// Aurora Rail — a fictional national rail-ticketing platform, and the reference workspace for
/// Stemma. Everything here is invented; it exists to exercise every part of the DSL on a domain
/// architects recognise instantly.
///
/// The story the model tells: Aurora sells rail tickets online. Journey Planning and Fares feed
/// a quote, Sales turns the quote into an order, Fulfilment signs a barcode and delivers it, Care
/// handles delays and refunds, and Revenue settles the money with the operators. Underneath, a
/// 1990s reservation mainframe (RESERVA) is being strangled: seat holds and gateline entitlements
/// still round-trip through it, which is where most of the open risks and questions live.
///
/// Conventions worth copying into your own workspace:
///   • One `var` per element, one per link — the engine reads these declarations directly.
///   • `Tag.For(...)` as a bare statement — that is the form Stemma writes when you tag from the UI.
///   • Ids are strings and the compiler does not check them. `AuroraRailSampleTests` does.
/// </summary>
public static class Architecture
{
    public static Model Build()
    {
        // --- Actors ---------------------------------------------------------------------------
        var perPassenger = new Person("per_passenger", "Passenger", "external");
        var perStaff = new Person("per_staff", "Station Staff", "internal");
        var perController = new Person("per_controller", "Disruption Controller", "internal");
        var perAnalyst = new Person("per_analyst", "Revenue Analyst", "internal");

        // --- Systems: ours, then the neighbours ------------------------------------------------
        var sysAurora = new SoftwareSystem("sys_aurora", "Aurora Rail Platform");
        var sysFares = new SoftwareSystem("sys_fares", "National Fares Database");
        var sysPayments = new SoftwareSystem("sys_payments", "Payment Gateway");
        var sysNotify = new SoftwareSystem("sys_notify", "Notification Provider");
        var sysReserva = new SoftwareSystem("sys_reserva", "RESERVA (legacy reservation mainframe)");
        var sysOpenData = new SoftwareSystem("sys_opendata", "Open Rail Data Feed");
        var sysWarehouse = new SoftwareSystem("sys_warehouse", "Group Data Warehouse");

        // --- Containers (deployables inside sys_aurora) ----------------------------------------
        var cntApp = new Container("cnt_app", "Passenger App & Web", "sys_aurora", "spa");
        var cntApi = new Container("cnt_api", "Booking API", "sys_aurora", "service");
        var cntFare = new Container("cnt_fare", "Fare Engine", "sys_aurora", "service");
        var cntIssuer = new Container("cnt_issuer", "Ticket Issuer", "sys_aurora", "service");
        var cntBus = new Container("cnt_bus", "Journey Event Bus", "sys_aurora", "broker");
        var cntStore = new Container("cnt_store", "Booking Store", "sys_aurora", "db");
        var cntSettle = new Container("cnt_settle", "Settlement Worker", "sys_aurora", "worker");
        var cntGateSync = new Container("cnt_gatesync", "Gateline Sync Job", "sys_aurora", "cronjob");

        // --- Bounded contexts ------------------------------------------------------------------
        var ctxJourney = new BoundedContext("ctx_journey", "Journey Planning");
        var ctxFares = new BoundedContext("ctx_fares", "Fares & Pricing");
        var ctxSales = new BoundedContext("ctx_sales", "Sales & Orders");
        var ctxFulfilment = new BoundedContext("ctx_fulfilment", "Ticket Fulfilment");
        var ctxCare = new BoundedContext("ctx_care", "Disruption & Refunds");
        var ctxRevenue = new BoundedContext("ctx_revenue", "Revenue & Settlement");

        // --- Modules, grouped by the context that owns them ------------------------------------
        var modTimetable = new Module("mod_timetable", "Timetable Ingest", "ctx_journey");
        var modPlanner = new Module("mod_planner", "Journey Planner", "ctx_journey");
        var modLive = new Module("mod_live", "Live Departures", "ctx_journey");

        var modFareImport = new Module("mod_fare_import", "Fares Import", "ctx_fares");
        var modFareRules = new Module("mod_fare_rules", "Fare Rules", "ctx_fares");
        var modRailcards = new Module("mod_railcards", "Railcards & Discounts", "ctx_fares");
        var modQuote = new Module("mod_quote", "Price Quote", "ctx_fares");

        var modBasket = new Module("mod_basket", "Basket", "ctx_sales");
        var modCheckout = new Module("mod_checkout", "Checkout", "ctx_sales");
        var modPayments = new Module("mod_payments", "Payment Orchestration", "ctx_sales");
        var modOrders = new Module("mod_orders", "Order History", "ctx_sales");

        var modIssuing = new Module("mod_issuing", "Ticket Issuing", "ctx_fulfilment");
        var modBarcode = new Module("mod_barcode", "Barcode Signing", "ctx_fulfilment");
        var modWallet = new Module("mod_wallet", "Wallet Delivery", "ctx_fulfilment");
        var modGateline = new Module("mod_gateline", "Gateline Entitlements", "ctx_fulfilment");

        var modDisruption = new Module("mod_disruption", "Disruption Feed", "ctx_care");
        var modDelayRepay = new Module("mod_delay_repay", "Delay Repay", "ctx_care");
        var modRefunds = new Module("mod_refunds", "Refund Engine", "ctx_care");

        var modApportion = new Module("mod_apportion", "Revenue Apportionment", "ctx_revenue");
        var modSettlement = new Module("mod_settlement", "Operator Settlement", "ctx_revenue");
        var modReporting = new Module("mod_reporting", "Revenue Reporting", "ctx_revenue");

        // --- Business capabilities --------------------------------------------------------------
        var capPlan = new Capability("cap_plan", "Plan a journey", "ctx_journey");
        var capPrice = new Capability("cap_price", "Price a journey", "ctx_fares");
        var capSell = new Capability("cap_sell", "Sell a ticket", "ctx_sales");
        var capFulfil = new Capability("cap_fulfil", "Deliver a valid ticket", "ctx_fulfilment");
        var capCompensate = new Capability("cap_compensate", "Compensate delayed passengers", "ctx_care");
        var capSettle = new Capability("cap_settle", "Settle revenue with operators", "ctx_revenue");

        // --- Use cases ---------------------------------------------------------------------------
        var ucBuy = new UseCase("uc_buy", "Buy an advance ticket");
        var ucChange = new UseCase("uc_change", "Change a booked journey");
        var ucClaim = new UseCase("uc_claim", "Claim Delay Repay");
        var ucGate = new UseCase("uc_gate", "Pass a gateline");

        // --- Data flows: how a ticket is sold, delivered, refunded and settled --------------------
        var flowPassengerApp = new DataFlow("flow_passenger_app", "per_passenger", "cnt_app", "Search · buy · claim");
        var flowStaffGate = new DataFlow("flow_staff_gate", "per_staff", "mod_gateline", "Manual entitlement override");
        var flowControllerFeed = new DataFlow("flow_controller_feed", "per_controller", "mod_disruption", "Declared disruption");
        var flowAnalystPack = new DataFlow("flow_analyst_pack", "mod_reporting", "per_analyst", "Daily revenue pack");

        var flowTimetable = new DataFlow("flow_timetable", "sys_opendata", "mod_timetable", "Timetable feed (nightly)");
        var flowRunning = new DataFlow("flow_running", "sys_opendata", "mod_live", "Live running & delay events");
        var flowFareBasis = new DataFlow("flow_fare_basis", "sys_fares", "mod_fare_import", "Fare-basis extract");
        var flowFarePublish = new DataFlow("flow_fare_publish", "mod_fare_import", "mod_fare_rules", "Published fare tables");

        var flowPlanQuote = new DataFlow("flow_plan_quote", "mod_planner", "mod_quote", "Itinerary to price");
        var flowQuoteBasket = new DataFlow("flow_quote_basket", "mod_quote", "mod_basket", "Priced itinerary");
        var flowBasketCheckout = new DataFlow("flow_basket_checkout", "mod_basket", "mod_checkout", "Basket contents");
        var flowAuthorise = new DataFlow("flow_authorise", "mod_payments", "sys_payments", "Authorisation", "twoway");
        var flowOrderPlaced = new DataFlow("flow_order_placed", "mod_checkout", "cnt_bus", "OrderPlaced");
        var flowReservaHold = new DataFlow("flow_reserva_hold", "mod_checkout", "sys_reserva", "Seat reservation hold");

        var flowIssueConsume = new DataFlow("flow_issue_consume", "cnt_bus", "mod_issuing", "OrderPlaced (consumed)");
        var flowSign = new DataFlow("flow_sign", "mod_issuing", "mod_barcode", "Ticket payload to sign");
        var flowWallet = new DataFlow("flow_wallet", "mod_barcode", "mod_wallet", "Signed barcode");
        var flowDeliver = new DataFlow("flow_deliver", "mod_wallet", "sys_notify", "Ticket email & push");
        var flowGateBatch = new DataFlow("flow_gate_batch", "mod_gateline", "sys_reserva", "Gateline entitlement batch", "twoway");

        var flowDelayClaim = new DataFlow("flow_delay_claim", "cnt_app", "mod_delay_repay", "Delay Repay claim");
        var flowAutoRefund = new DataFlow("flow_auto_refund", "mod_disruption", "mod_refunds", "Auto-refund trigger");
        var flowRefundOut = new DataFlow("flow_refund_out", "mod_refunds", "sys_payments", "Refund instruction");

        var flowTicketEvents = new DataFlow("flow_ticket_events", "cnt_bus", "mod_apportion", "TicketIssued · TicketRefunded");
        var flowSettleExtract = new DataFlow("flow_settle_extract", "mod_settlement", "sys_warehouse", "Daily settlement extract");

        // --- Dependencies: what calls, uses, reads or consumes what -------------------------------
        var depAppApi = new Dependency("dep_app_api", "cnt_app", "cnt_api", "calls");
        var depApiFare = new Dependency("dep_api_fare", "cnt_api", "cnt_fare", "calls");
        var depApiStore = new Dependency("dep_api_store", "cnt_api", "cnt_store", "reads");
        var depIssuerBus = new Dependency("dep_issuer_bus", "cnt_issuer", "cnt_bus", "consumes");
        var depSettleBus = new Dependency("dep_settle_bus", "cnt_settle", "cnt_bus", "consumes");
        var depGateSyncStore = new Dependency("dep_gatesync_store", "cnt_gatesync", "cnt_store", "reads");

        var depPlannerTimetable = new Dependency("dep_planner_timetable", "mod_planner", "mod_timetable", "uses");
        var depLiveTimetable = new Dependency("dep_live_timetable", "mod_live", "mod_timetable", "reads");
        var depQuoteRules = new Dependency("dep_quote_rules", "mod_quote", "mod_fare_rules", "uses");
        var depQuoteRailcards = new Dependency("dep_quote_railcards", "mod_quote", "mod_railcards", "uses");
        var depBasketQuote = new Dependency("dep_basket_quote", "mod_basket", "mod_quote", "calls");
        var depCheckoutPayments = new Dependency("dep_checkout_payments", "mod_checkout", "mod_payments", "uses");
        var depCheckoutOrders = new Dependency("dep_checkout_orders", "mod_checkout", "mod_orders", "uses");
        var depIssuingBarcode = new Dependency("dep_issuing_barcode", "mod_issuing", "mod_barcode", "uses");
        var depWalletOrders = new Dependency("dep_wallet_orders", "mod_wallet", "mod_orders", "reads");
        var depGatelineOrders = new Dependency("dep_gateline_orders", "mod_gateline", "mod_orders", "reads");
        var depDelayRefunds = new Dependency("dep_delay_refunds", "mod_delay_repay", "mod_refunds", "calls");
        var depRefundsOrders = new Dependency("dep_refunds_orders", "mod_refunds", "mod_orders", "reads");
        var depApportionOrders = new Dependency("dep_apportion_orders", "mod_apportion", "mod_orders", "reads");
        var depSettlementApportion = new Dependency("dep_settlement_apportion", "mod_settlement", "mod_apportion", "uses");
        var depReportingSettlement = new Dependency("dep_reporting_settlement", "mod_reporting", "mod_settlement", "reads");

        // --- Open concerns: what we are worried about, unsure of, and taking on faith -------------
        var riskFareDrift = new Risk("risk_fare_drift", "Fare rules can drift from RESERVA while both price tickets", "mod_fare_rules");
        var riskBarcodeReplay = new Risk("risk_barcode_replay", "Signed barcodes are replayable while gateline sync lags", "mod_barcode");
        var riskStrikeLoad = new Risk("risk_strike_load", "Strike days push refunds to 20x normal volume", "mod_refunds");
        var riskBatchWindow = new Risk("risk_batch_window", "RESERVA accepts batches only between 02:00 and 04:00", "sys_reserva");

        var qRailcardOwner = new Question("q_railcard_owner", "Do railcard discounts belong to Fares or to Sales?", "mod_railcards");
        var qApportionOwner = new Question("q_apportion_owner", "Who owns apportionment once RESERVA is retired?", "mod_apportion");
        var qWalletOffline = new Question("q_wallet_offline", "Must wallet tickets validate fully offline?", "mod_wallet");

        var asmFareDaily = new Assumption("asm_fare_daily", "Fare basis changes at most once per day", "mod_fare_import");
        var asmOpenData = new Assumption("asm_opendata", "The open data feed is authoritative for Delay Repay", "mod_disruption");
        var asmGateLatency = new Assumption("asm_gate_latency", "Gatelines tolerate 15 minutes of entitlement latency", "mod_gateline");

        // --- Lifecycle & ownership ----------------------------------------------------------------
        // Written as bare `Tag.For(...)` statements: exactly what Stemma emits when you set a
        // lifecycle or owner from the inspector, so the file round-trips unchanged.
        Tag.For(sysReserva, lifecycle: new Lifecycle(Status: "deprecated", Phase: "retire by 2027-06", ValidUntil: "2027-06-30"), ownership: new Ownership(Squad: "Platform", Domain: "Legacy"));
        Tag.For(cntApi, lifecycle: new Lifecycle(Status: "current", Phase: "GA"), ownership: new Ownership(Squad: "Sell", Domain: "Booking"));
        Tag.For(cntFare, lifecycle: new Lifecycle(Status: "current", Phase: "GA"), ownership: new Ownership(Squad: "Price", Domain: "Pricing"));
        Tag.For(cntBus, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Platform", Domain: "Messaging"));
        Tag.For(cntGateSync, lifecycle: new Lifecycle(Status: "to-adapt", Phase: "RESERVA bridge"), ownership: new Ownership(Squad: "Fulfil", Domain: "Entitlements"));

        Tag.For(modTimetable, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Discover", Domain: "Journey"));
        Tag.For(modPlanner, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Discover", Domain: "Journey"));
        Tag.For(modFareRules, lifecycle: new Lifecycle(Status: "current", Phase: "dual-run with RESERVA"), ownership: new Ownership(Squad: "Price", Domain: "Pricing"));
        Tag.For(modRailcards, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Price", Domain: "Pricing"));
        Tag.For(modCheckout, lifecycle: new Lifecycle(Status: "current", Phase: "GA"), ownership: new Ownership(Squad: "Sell", Domain: "Orders"));
        Tag.For(modBarcode, lifecycle: new Lifecycle(Status: "current", Phase: "security-critical"), ownership: new Ownership(Squad: "Fulfil", Domain: "Tickets"));
        Tag.For(modWallet, lifecycle: new Lifecycle(Status: "target", Phase: "offline validation next"), ownership: new Ownership(Squad: "Fulfil", Domain: "Tickets"));
        Tag.For(modGateline, lifecycle: new Lifecycle(Status: "to-adapt", Phase: "moves off RESERVA in phase 3"), ownership: new Ownership(Squad: "Fulfil", Domain: "Entitlements"));
        Tag.For(modDelayRepay, lifecycle: new Lifecycle(Status: "current", ValidFrom: "2026-02-01"), ownership: new Ownership(Squad: "Care", Domain: "Compensation"));
        Tag.For(modApportion, lifecycle: new Lifecycle(Status: "to-be-created", Phase: "design"), ownership: new Ownership(Squad: "Insight", Domain: "Revenue"));
        Tag.For(modSettlement, lifecycle: new Lifecycle(Status: "to-be-created", Phase: "design"), ownership: new Ownership(Squad: "Insight", Domain: "Revenue"));
        Tag.For(flowReservaHold, lifecycle: new Lifecycle(Status: "deprecated", Phase: "removed with RESERVA"));
        Tag.For(flowGateBatch, lifecycle: new Lifecycle(Status: "to-adapt"));

        return Model.Of(
            perPassenger, perStaff, perController, perAnalyst,
            sysAurora, sysFares, sysPayments, sysNotify, sysReserva, sysOpenData, sysWarehouse,
            cntApp, cntApi, cntFare, cntIssuer, cntBus, cntStore, cntSettle, cntGateSync,
            ctxJourney, ctxFares, ctxSales, ctxFulfilment, ctxCare, ctxRevenue,
            modTimetable, modPlanner, modLive,
            modFareImport, modFareRules, modRailcards, modQuote,
            modBasket, modCheckout, modPayments, modOrders,
            modIssuing, modBarcode, modWallet, modGateline,
            modDisruption, modDelayRepay, modRefunds,
            modApportion, modSettlement, modReporting,
            capPlan, capPrice, capSell, capFulfil, capCompensate, capSettle,
            ucBuy, ucChange, ucClaim, ucGate,
            flowPassengerApp, flowStaffGate, flowControllerFeed, flowAnalystPack,
            flowTimetable, flowRunning, flowFareBasis, flowFarePublish,
            flowPlanQuote, flowQuoteBasket, flowBasketCheckout, flowAuthorise, flowOrderPlaced, flowReservaHold,
            flowIssueConsume, flowSign, flowWallet, flowDeliver, flowGateBatch,
            flowDelayClaim, flowAutoRefund, flowRefundOut,
            flowTicketEvents, flowSettleExtract,
            depAppApi, depApiFare, depApiStore, depIssuerBus, depSettleBus, depGateSyncStore,
            depPlannerTimetable, depLiveTimetable, depQuoteRules, depQuoteRailcards, depBasketQuote,
            depCheckoutPayments, depCheckoutOrders, depIssuingBarcode, depWalletOrders, depGatelineOrders,
            depDelayRefunds, depRefundsOrders, depApportionOrders, depSettlementApportion, depReportingSettlement,
            riskFareDrift, riskBarcodeReplay, riskStrikeLoad, riskBatchWindow,
            qRailcardOwner, qApportionOwner, qWalletOffline,
            asmFareDaily, asmOpenData, asmGateLatency);
    }
}
