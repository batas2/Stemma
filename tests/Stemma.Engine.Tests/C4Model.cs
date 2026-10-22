using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;

namespace Stemma.Engine.Tests;

/// <summary>
/// A shop and its neighbours, written as an agent writes C4: people, two systems with containers, an
/// external system, flows across the boundary in both directions, two flows between the same pair,
/// a flow inside each system, and a module nothing in C4 lifts. The selector and projection tests
/// read it through the reader, as the engine does.
/// </summary>
internal static class C4Model
{
    public const string Source = """
        using Stemma.Model;

        public static class Architecture
        {
            public static Model Build()
            {
                var buyer = new Person("per_buyer", "Buyer", "external");
                var admin = new Person("per_admin", "Admin");
                var shop = new SoftwareSystem("sys_shop", "Shop", "Where orders are placed");
                var payments = new SoftwareSystem("sys_payments", "Payments");
                var mail = new SoftwareSystem("sys_mail", "Mail");
                var hr = new SoftwareSystem("sys_hr", "HR");
                var web = new Container("cnt_web", "Web Shop", "sys_shop", "spa", Technology: "React");
                var api = new Container("cnt_api", "Order API", "sys_shop", Technology: ".NET 8");
                var db = new Container("cnt_db", "Order Store", "sys_shop", "db", "PostgreSQL");
                var gateway = new Container("cnt_gateway", "Gateway", "sys_payments");
                var ledger = new Container("cnt_ledger", "Ledger", "sys_payments", "db");
                var ctx = new BoundedContext("ctx_sales", "Sales");
                var checkout = new Module("mod_checkout", "Checkout", "ctx_sales");
                var quote = new Capability("cap_quote", "Quote", "ctx_sales");

                var browse = new DataFlow("flow_browse", "per_buyer", "cnt_web", "search terms");
                var call = new DataFlow("flow_call", "cnt_web", "cnt_api", "orders", Technology: "HTTPS/JSON");
                var persist = new DataFlow("flow_persist", "cnt_api", "cnt_db", "order");
                var pay = new DataFlow("flow_pay", "cnt_api", "cnt_gateway", "payment");
                var refund = new DataFlow("flow_refund", "cnt_api", "cnt_gateway", "refund");
                var settle = new DataFlow("flow_settle", "cnt_gateway", "cnt_ledger", "entry");
                var notify = new DataFlow("flow_notify", "cnt_api", "sys_mail", "email");
                var manage = new Relation("rel_manage", "per_admin", "sys_shop", "manages");
                var confirm = new DataFlow("flow_confirm", "cnt_gateway", "cnt_api", "confirmation");
                var rota = new DataFlow("flow_rota", "sys_hr", "per_admin", "rota");
                var uses = new Dependency("dep_web_checkout", "cnt_web", "mod_checkout");

                Tag.For(api, lifecycle: new Lifecycle(Status: "current"), ownership: new Ownership(Squad: "Sell"));
                Tag.For(ledger, lifecycle: new Lifecycle(Status: "deprecated"));

                return Model.Of(buyer, admin, shop, payments, mail, hr, web, api, db, gateway, ledger, ctx, checkout, quote,
                    browse, call, persist, pay, refund, settle, notify, manage, confirm, rota, uses);
            }
        }
        """;

    public static ArchModel.ArchModel Read(string source = Source) =>
        DslReader.TryRead("/tmp/Architecture.cs", CSharpSyntaxTree.ParseText(source).GetRoot())!;
}
