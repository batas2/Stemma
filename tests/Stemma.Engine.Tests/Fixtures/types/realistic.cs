// The ordering domain. Maintained by hand and by Stemma; a diff from either should read the same.
using System;

namespace Fixture
{
    /// <summary>Anything with a price.</summary>
    public interface IPriced
    {
    }

    /// <summary>Anything with an audit trail.</summary>
    public interface IAudited
    {
    }

    /// <summary>The base of every entity.</summary>
    public abstract class Entity
    {
    }

    #region Orders
    /// <summary>An order, as the customer placed it.</summary>
    [Serializable]
    public class Order : Entity, IPriced // the price comes from its lines
    {
        /// <summary>Assigned on creation.</summary>
        public Guid Id { get; init; }

        // Free text from the customer.
        public string Note { get; set; } = "";
    }
    #endregion

    /// <summary>What the customer is billed.</summary>
    public class Invoice
    {
        public decimal Total { get; set; } // incl. tax
    }
}
