using Stemma.Model;

namespace FoodDelivery;

/// <summary>What Dishwise is made of and how its parts talk. No member is listed: the lens finds them.</summary>
public static class Containers
{
    public static View Define() => new(
        Id: "view_containers",
        Name: "Dishwise — containers",
        BaseView: "container",
        Scope: "sys_platform");
}
