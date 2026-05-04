namespace Demo.Orders;

public interface IEntity
{
    Guid Id { get; }
}

// A simple customer record.
public class Customer : IEntity
{
    public Guid Id { get; init; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}
