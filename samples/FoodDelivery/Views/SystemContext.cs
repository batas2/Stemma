using Stemma.Model;

namespace FoodDelivery;

/// <summary>Who uses Dishwise and what it depends on — the first picture for anyone new.</summary>
public static class SystemContext
{
    public static View Define() => new(
        Id: "view_context",
        Name: "Dishwise in context",
        BaseView: "systemContext",
        Scope: "sys_platform");
}
