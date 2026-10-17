// Pathological: a BOM, tabs, CRLF in the body, a base list over three lines with a block
// comment in it, and a preprocessor block between two members.
using System;
namespace Fixture;

public interface IPriced { }
public interface IAudited { }
public class Entity { }

public class Order :
	Entity, /* first, always */
	IPriced
{
	public Guid Id { get; init; }
#if DEBUG
	// debug-only members would go here
#endif
	public string Note { get; set; } = "";
}

public class Invoice {
	public decimal Total { get; set; }
}
