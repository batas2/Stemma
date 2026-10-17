using System;

namespace Fixture;

public interface IPriced
{
}

public interface IAudited
{
}

public class Entity
{
}

public class Order : Entity, IPriced
{
    public Guid Id { get; init; }
    public string Note { get; set; } = "";
}

public class Invoice
{
    public decimal Total { get; set; }
}
