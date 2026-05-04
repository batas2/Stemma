namespace Demo.Orders;

// Aggregate root for an order.
public class Order
{
    public Guid Id { get; init; }
    public string CustomerName { get; set; } = string.Empty;
    public List<OrderLine> Lines { get; set; } = [];
}

public class OrderLine
{
    public string Sku { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}
