using Stemma.Engine.Models;
using Stemma.Engine.Operations;

namespace Stemma.Engine.Tests.Fidelity;

/// <summary>
/// The type operations, against <c>Fixtures/types/</c>: one ordering domain written three ways. The
/// operation is built from the path of the file under test, because adding a type names the file
/// it goes in.
/// </summary>
public sealed record TypeFidelityCase(string Name, Func<string, OperationBase> Op, IReadOnlyList<(string From, string To)> Edits);

public static class TypeFidelityCases
{
    private const string Op = "op";

    private static TypeFidelityCase Case(string name, Func<string, OperationBase> op, params (string From, string To)[] edits) => new(name, op, edits);

    public static readonly IReadOnlyDictionary<string, IReadOnlyList<TypeFidelityCase>> All = new Dictionary<string, IReadOnlyList<TypeFidelityCase>>
    {
        ["minimal"] = Minimal(),
        ["realistic"] = Realistic(),
        ["pathological"] = Pathological(),
    };

    public static TypeFidelityCase Find(string fixture, string name) => All[fixture].Single(c => c.Name == name);

    private static IEnumerable<TypeFidelityCase> Common(string fixture) =>
    [
        Case("RenameType", _ => new RenameTypeOp(Op, "Fixture.Invoice", "Bill")),
        Case("RemoveType", _ => new RemoveTypeOp(Op, "Fixture.Invoice")),
        Case("AddProperty", _ => new AddPropertyOp(Op, "Fixture.Invoice", "Tax", "decimal", Visibility.Public, true, true, false)),
        Case("RenameProperty", _ => new RenamePropertyOp(Op, "Fixture.Order", "Note", "Remark"),
            ("public string Note", "public string Remark")),
        Case("RemoveProperty", _ => new RemovePropertyOp(Op, "Fixture.Order", "Note")),
        Case("AddInheritance", _ => new AddInheritanceOp(Op, "Fixture.Invoice", "Fixture.Entity")),
        Case("RemoveInheritance", _ => new RemoveInheritanceOp(Op, "Fixture.Order")),
        Case("AddImplementation.new-list", _ => new AddImplementationOp(Op, "Fixture.Invoice", "Fixture.IAudited")),
        Case("AddImplementation.append", _ => new AddImplementationOp(Op, "Fixture.Order", "Fixture.IAudited")),
        Case("RemoveImplementation", _ => new RemoveImplementationOp(Op, "Fixture.Order", "Fixture.IPriced")),
        Case("AddType.existing-file", path => new AddTypeOp(Op, path, "Fixture", "Payment", TypeKind.Class, Visibility.Public)),
    ];

    /// <summary>The common cases with this fixture's expected edits; a case with edits of its own keeps them.</summary>
    private static IReadOnlyList<TypeFidelityCase> With(string fixture, Dictionary<string, (string From, string To)[]> edits) =>
        Common(fixture).Select(c => c.Edits.Count > 0 ? c : c with { Edits = edits[c.Name] }).ToList();

    private static IReadOnlyList<TypeFidelityCase> Minimal() => With("minimal", new()
    {
        ["RenameType"] = [("public class Invoice", "public class Bill")],
        ["RemoveType"] = [("    public string Note { get; set; } = \"\";\n}\n\npublic class Invoice\n{\n    public decimal Total { get; set; }\n}\n",
                           "    public string Note { get; set; } = \"\";\n}\n")],
        ["AddProperty"] = [("    public decimal Total { get; set; }\n", "    public decimal Total { get; set; }\n    public decimal Tax { get; set; }\n")],
        ["RemoveProperty"] = [("    public string Note { get; set; } = \"\";\n", "")],
        ["AddInheritance"] = [("public class Invoice\n", "public class Invoice : Entity\n")],
        ["RemoveInheritance"] = [("public class Order : Entity, IPriced", "public class Order : IPriced")],
        ["AddImplementation.new-list"] = [("public class Invoice\n", "public class Invoice : IAudited\n")],
        ["AddImplementation.append"] = [("public class Order : Entity, IPriced", "public class Order : Entity, IPriced, IAudited")],
        ["RemoveImplementation"] = [("public class Order : Entity, IPriced", "public class Order : Entity")],
        ["AddType.existing-file"] = [("    public decimal Total { get; set; }\n}\n", "    public decimal Total { get; set; }\n}\n\npublic class Payment\n{\n}\n")],
    });

    private static IReadOnlyList<TypeFidelityCase> Realistic() => With("realistic", new()
    {
        ["RenameType"] = [("public class Invoice", "public class Bill")],
        // The #endregion above the invoice's doc comment is not the invoice's, and stays; the doc comment is.
        ["RemoveType"] = [("    #endregion\n\n    /// <summary>What the customer is billed.</summary>\n    public class Invoice\n    {\n        public decimal Total { get; set; } // incl. tax\n    }\n",
                           "    #endregion\n")],
        ["AddProperty"] = [("        public decimal Total { get; set; } // incl. tax\n",
                            "        public decimal Total { get; set; } // incl. tax\n        public decimal Tax { get; set; }\n")],
        // A plain comment above a member may head a group, so it stays — as it does for a declaration in a model.
        ["RemoveProperty"] = [("        public string Note { get; set; } = \"\";\n", "")],
        ["AddInheritance"] = [("    public class Invoice\n", "    public class Invoice : Entity\n")],
        ["RemoveInheritance"] = [("public class Order : Entity, IPriced //", "public class Order : IPriced //")],
        ["AddImplementation.new-list"] = [("    public class Invoice\n", "    public class Invoice : IAudited\n")],
        ["AddImplementation.append"] = [("Entity, IPriced // the price", "Entity, IPriced, IAudited // the price")],
        ["RemoveImplementation"] = [("Entity, IPriced // the price", "Entity // the price")],
        ["AddType.existing-file"] = [("        public decimal Total { get; set; } // incl. tax\n    }\n}\n",
                                      "        public decimal Total { get; set; } // incl. tax\n    }\n\n    public class Payment\n    {\n    }\n}\n")],
    });

    private static IReadOnlyList<TypeFidelityCase> Pathological() => With("pathological", new()
    {
        ["RenameType"] = [("public class Invoice {", "public class Bill {")],
        ["RemoveType"] = [("}\r\n\r\npublic class Invoice {\r\n\tpublic decimal Total { get; set; }\r\n}\r\n", "}\r\n")],
        ["AddProperty"] = [("\tpublic decimal Total { get; set; }\r\n", "\tpublic decimal Total { get; set; }\r\n\tpublic decimal Tax { get; set; }\r\n")],
        // The preprocessor block above Note is not Note's.
        ["RemoveProperty"] = [("\tpublic string Note { get; set; } = \"\";\r\n", "")],
        ["AddInheritance"] = [("public class Invoice {", "public class Invoice : Entity {")],
        // Entity had its line to itself, block comment included, so the line goes.
        ["RemoveInheritance"] = [("public class Order :\r\n\tEntity, /* first, always */\r\n\tIPriced\r\n", "public class Order :\r\n\tIPriced\r\n")],
        ["AddImplementation.new-list"] = [("public class Invoice {", "public class Invoice : IAudited {")],
        ["AddImplementation.append"] = [("\tIPriced\r\n{", "\tIPriced,\r\n\tIAudited\r\n{")],
        // The comment was on Entity's line; only the comma that followed it goes.
        ["RemoveImplementation"] = [("\tEntity, /* first, always */\r\n\tIPriced\r\n{", "\tEntity /* first, always */\r\n{")],
        ["AddType.existing-file"] = [("\tpublic decimal Total { get; set; }\r\n}\r\n", "\tpublic decimal Total { get; set; }\r\n}\r\n\r\npublic class Payment\r\n{\r\n}\r\n")],
    });
}
