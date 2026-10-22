using System.Collections.Concurrent;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;

namespace Stemma.Engine.Validation;

/// <summary>The kinds of rule a workspace declares. A pack is turned on rather than declared (<see cref="PackUse"/>).</summary>
public enum DeclaredRuleKind { Forbid, Only, Layers, Require }

/// <summary>
/// A rule as a <c>Rules/*.cs</c> file declares it (ADR-0028), read off the syntax tree. Its selectors
/// have all been parsed: a rule with one Stemma cannot read is a <see cref="RuleProblem"/> instead.
/// </summary>
/// <param name="Via">The relationships the rule considers; null for data flows and dependencies both.</param>
/// <param name="File">The file it is declared in, relative to the workspace, with forward slashes.</param>
/// <param name="Line">1-based, as an editor shows it.</param>
public sealed record DeclaredRule(
    DeclaredRuleKind Kind,
    string Id,
    string? From,
    string? To,
    IReadOnlyList<string> Layers,
    string? Of,
    string? Has,
    string? Because,
    ArchLinkKind? Via,
    Severity Severity,
    string File,
    int Line);

/// <summary><c>Rule.Use("c4")</c>: a built-in pack turned on, and where.</summary>
public sealed record PackUse(string Pack, string File, int Line);

/// <summary><c>Code.At(path)</c>: where the implementation lives, relative to the workspace (ADR-0029).</summary>
public sealed record CodeRootDeclaration(string Path, string File, int Line);

/// <summary><c>Code.Map(id, path)</c>: the project, or folder of projects, implementing an element, relative to <see cref="CodeRootDeclaration"/>.</summary>
public sealed record CodeMapDeclaration(string ElementId, string Path, string File, int Line);

/// <summary>A mistake in a rules file — a rule Stemma cannot check — with its file and line in the message.</summary>
/// <param name="Rule">As <c>stemma validate</c> names it: <c>rule/unreadable</c>, <c>rule/bad-selector</c>, ….</param>
public sealed record RuleProblem(string Rule, Severity Severity, string Message);

/// <summary>
/// Everything the <c>Rules/*.cs</c> files of a workspace declare: rules, packs and the code map — and every
/// mistake that keeps one from being checked, said rather than skipped.
///
/// A rules file is any C# file in a folder named <c>Rules</c> inside the workspace, at any depth — counted
/// from the workspace root, never above it, never in build output or a dot-folder — as a view file is
/// one in <c>Views</c>. Rules are read off the syntax tree and never run (ADR-0028): every
/// <c>Rule.&lt;Kind&gt;(…)</c> and <c>Code.&lt;Kind&gt;(…)</c> call in the file, its arguments positional or
/// named, a string list written <c>new[] { … }</c> or <c>[ … ]</c>. An argument is read when C# would fold it
/// into a constant string — a literal, a <c>const</c> declared in the file, <c>+</c> and interpolation over
/// those (the model's rule, <see cref="DslConstants"/>). Anything else is <c>rule/unreadable</c>.
/// </summary>
public sealed record DeclaredRules(
    IReadOnlyList<string> Files,
    IReadOnlyList<DeclaredRule> Rules,
    IReadOnlyList<PackUse> Packs,
    IReadOnlyList<CodeRootDeclaration> CodeRoots,
    IReadOnlyList<CodeMapDeclaration> CodeMaps,
    IReadOnlyList<RuleProblem> Problems)
{
    public const string BadSelector = "rule/bad-selector";
    public const string DanglingId = "rule/dangling-id";
    public const string DuplicateId = "rule/duplicate-id";
    public const string Unreadable = "rule/unreadable";
    public const string Unknown = "rule/unknown";

    /// <summary>The ids of the mistakes, each a rule <c>stemma.rules.json</c> can quieten like any other.</summary>
    public static readonly IReadOnlyList<string> MistakeIds = [BadSelector, DanglingId, DuplicateId, Unreadable, Unknown];

    /// <summary>The packs <c>Rule.Use</c> can turn on.</summary>
    public static readonly IReadOnlyList<string> KnownPacks = [C4Pack.Name];

    public static readonly DeclaredRules None = new([], [], [], [], [], []);

    /// <summary>Whether a <c>Rule.Use</c> turns <paramref name="pack"/> on.</summary>
    public bool Uses(string pack) => Packs.Any(p => p.Pack.Equals(pack, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Whether <paramref name="path"/> is in a folder called Rules inside the workspace, at any depth —
    /// counted from <paramref name="workspaceRoot"/>, never from the top of the disk, by the rule a view
    /// file is found by (<see cref="ViewsAdapter.IsViewFile"/>).
    /// </summary>
    public static bool IsRulesFile(string workspaceRoot, string path)
    {
        var relative = Path.GetRelativePath(workspaceRoot, path);
        if (relative.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relative)) return false;
        return relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).SkipLast(1)
            .Contains("Rules", StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>The rules files of the workspace as they are on disk, in path order; build output and dot-folders are not entered.</summary>
    public static IReadOnlyList<string> FilesIn(string workspaceRoot)
    {
        if (!Directory.Exists(workspaceRoot)) return [];
        var root = Path.GetFullPath(workspaceRoot);
        return ModelWorkspaceLoader.SourcesIn(root).Where(f => IsRulesFile(root, f)).Order(StringComparer.Ordinal).ToList();
    }

    /// <summary>Per file, as last read: when it was written, how long it was, and what it declares.</summary>
    private static readonly ConcurrentDictionary<string, (DateTime Written, long Length, FileRules Rules)> Cache = new(StringComparer.Ordinal);

    /// <summary>
    /// What the workspace at <paramref name="workspaceRoot"/> declares, read from disk. The canvas asks
    /// every second and a half, so a file is parsed again only when its time or length changes.
    /// </summary>
    public static DeclaredRules Read(string workspaceRoot)
    {
        var files = FilesIn(workspaceRoot);
        if (files.Count == 0) return None;
        var root = Path.GetFullPath(workspaceRoot);
        var read = new List<FileRules>();
        foreach (var file in files)
        {
            var shown = Shown(root, file);
            try
            {
                var info = new FileInfo(file);
                var key = root + "\n" + file;
                if (Cache.TryGetValue(key, out var known) && known.Written == info.LastWriteTimeUtc && known.Length == info.Length)
                {
                    read.Add(known.Rules);
                    continue;
                }
                var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(file), path: file);
                var rules = ReadFile(shown, tree.GetRoot());
                Cache[key] = (info.LastWriteTimeUtc, info.Length, rules);
                read.Add(rules);
            }
            catch (FileNotFoundException)
            {
                // Deleted between the walk and the read: there is nothing in it to check.
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                read.Add(new FileRules([], [], [], [],
                    [new(Unreadable, Severity.Error, $"{shown}: could not be read ({e.Message}), so none of its rules are checked")]));
            }
        }
        return Combine(files.Select(f => Shown(root, f)).ToList(), read);
    }

    /// <summary>What <paramref name="files"/> declare, each already parsed — for a caller that holds the trees.</summary>
    public static DeclaredRules ReadFrom(string workspaceRoot, IEnumerable<(string FilePath, SyntaxNode Root)> files)
    {
        var root = Path.GetFullPath(workspaceRoot);
        var shown = new List<string>();
        var read = new List<FileRules>();
        foreach (var (path, tree) in files.Where(f => IsRulesFile(root, f.FilePath)).OrderBy(f => f.FilePath, StringComparer.Ordinal))
        {
            shown.Add(Shown(root, path));
            read.Add(ReadFile(shown[^1], tree));
        }
        return shown.Count == 0 ? None : Combine(shown, read);
    }

    private static string Shown(string root, string file) => Path.GetRelativePath(root, file).Replace('\\', '/');

    /// <summary>Every file's declarations as one, with what only the whole can show: an id declared twice, a second <c>Code.At</c>.</summary>
    private static DeclaredRules Combine(IReadOnlyList<string> files, IReadOnlyList<FileRules> read)
    {
        var rules = read.SelectMany(r => r.Rules).ToList();
        var roots = read.SelectMany(r => r.Roots).ToList();
        var problems = read.SelectMany(r => r.Problems).ToList();

        var reserved = ReservedIds.Value;
        foreach (var group in rules.GroupBy(r => r.Id, StringComparer.Ordinal))
        {
            var first = group.First();
            if (reserved.Contains(group.Key))
                problems.Add(new(DuplicateId, Severity.Error,
                    $"{first.File}:{first.Line}: '{group.Key}' is the id of a built-in rule; give this rule its own, or its violations and " +
                    "stemma.rules.json cannot tell the two apart"));
            foreach (var again in group.Skip(1))
                problems.Add(new(DuplicateId, Severity.Error,
                    $"{again.File}:{again.Line}: the rule id '{group.Key}' is declared again here, first at {first.File}:{first.Line}; " +
                    "give each rule its own, or their violations and stemma.rules.json cannot tell them apart"));
        }
        foreach (var again in roots.Skip(1))
            problems.Add(new(DuplicateId, Severity.Error,
                $"{again.File}:{again.Line}: Code.At is written again here, first at {roots[0].File}:{roots[0].Line}, which is the one used; " +
                "the code lives in one place"));

        return new DeclaredRules(files, rules, read.SelectMany(r => r.Packs).ToList(), roots,
            read.SelectMany(r => r.Maps).ToList(), problems);
    }

    /// <summary>The ids a declared rule may not take: the built-in rules', the packs' and the mistakes'.</summary>
    private static readonly Lazy<HashSet<string>> ReservedIds = new(() =>
        RuleEngine.DiscoverRulesIn(typeof(IRule).Assembly).Select(r => r.Id)
            .Concat(C4Pack.Ids).Concat(MistakeIds)
            .ToHashSet(StringComparer.Ordinal));

    private sealed record FileRules(
        IReadOnlyList<DeclaredRule> Rules,
        IReadOnlyList<PackUse> Packs,
        IReadOnlyList<CodeRootDeclaration> Roots,
        IReadOnlyList<CodeMapDeclaration> Maps,
        IReadOnlyList<RuleProblem> Problems);

    /// <summary>
    /// The parameters of each <c>Rule</c> and <c>Code</c> method, in order, and which of them must be
    /// given. They are the parameters of <c>Stemma.Model.Rule</c> and <c>Stemma.Model.Code</c>, and must
    /// stay so: a test holds the two together.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, (string[] Parameters, string[] Required)> Shapes =
        new Dictionary<string, (string[], string[])>(StringComparer.Ordinal)
        {
            ["Rule.Forbid"] = (["id", "from", "to", "because", "via", "severity"], ["id", "from", "to"]),
            ["Rule.Only"] = (["id", "from", "to", "because", "via", "severity"], ["id", "from", "to"]),
            ["Rule.Layers"] = (["id", "layers", "because", "via", "severity"], ["id", "layers"]),
            ["Rule.Require"] = (["id", "of", "has", "because", "severity"], ["id", "of", "has"]),
            ["Rule.Use"] = (["pack"], ["pack"]),
            ["Code.At"] = (["path"], ["path"]),
            ["Code.Map"] = (["id", "path"], ["id", "path"]),
        };

    /// <summary>What a <c>Require</c> may ask an element to have: any argument of any kind, its id and name, and what its tags carry.</summary>
    private static readonly HashSet<string> ElementAttributes = Enum.GetNames<ArchElementKind>()
        .SelectMany(kind => DslVocabulary.ParametersOf(kind) ?? [])
        .Concat(["status", "phase", "squad", "domain"])
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>What a <c>Require</c> may ask a link to have.</summary>
    private static readonly HashSet<string> LinkAttributes =
        new(["id", "label", "payload", "direction", "technology", "kind", "status", "phase", "squad", "domain"], StringComparer.OrdinalIgnoreCase);

    private const string Advice = "Write it as a string literal, or as a const string declared in this file.";

    /// <summary>One file's declarations, and the mistakes that keep any of them from being checked.</summary>
    private static FileRules ReadFile(string file, SyntaxNode root)
    {
        var rules = new List<DeclaredRule>();
        var packs = new List<PackUse>();
        var roots = new List<CodeRootDeclaration>();
        var maps = new List<CodeMapDeclaration>();
        var problems = new List<RuleProblem>();

        void Problem(string rule, Severity severity, SyntaxNode at, string text) =>
            problems.Add(new(rule, severity, $"{file}:{LineOf(at)}: {text}"));

        // A rule constructed rather than declared through Rule.… is not one Stemma reads.
        foreach (var creation in root.DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            var type = DslReader.GetSimpleTypeName(creation.Type);
            if (type is "ArchitectureRule" or "CodeRoot" or "CodeMap")
                Problem(Unreadable, Severity.Error, creation,
                    $"this {type} is constructed directly, and Stemma reads only Rule.…(…) and Code.…(…) calls, so it is not checked");
        }

        foreach (var call in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (call.Expression is not MemberAccessExpressionSyntax { Name: IdentifierNameSyntax method } access) continue;
            var owner = OwnerName(access.Expression);
            if (owner is not ("Rule" or "Code")) continue;
            var name = $"{owner}.{method.Identifier.Text}";
            if (!Shapes.TryGetValue(name, out var shape))
            {
                var known = string.Join(", ", Shapes.Keys.Where(k => k.StartsWith(owner + ".", StringComparison.Ordinal)));
                Problem(Unknown, Severity.Error, call, $"{name} is not something Stemma knows (known: {known}), so it is not checked");
                continue;
            }
            if (Arguments(call, name, shape.Parameters) is not { } args) continue;

            // The id first, so that every later problem can name the rule it belongs to.
            string? id = null;
            if (args.TryGetValue("id", out var idArg))
            {
                if (!DslConstants.TryRead(idArg, null, out id))
                {
                    Problem(Unreadable, Severity.Error, idArg,
                        $"the id of {name} is written as `{Quote(idArg)}`, which Stemma cannot read, so it is not checked. {Advice}");
                    continue;
                }
                if (string.IsNullOrWhiteSpace(id))
                {
                    Problem(Unreadable, Severity.Error, idArg, $"{name} has an empty id, so it is not checked");
                    continue;
                }
            }
            var label = id is null ? name : $"{name}(\"{id}\")";
            var leftOut = false;
            foreach (var required in shape.Required.Where(r => !args.ContainsKey(r)))
            {
                Problem(Unreadable, Severity.Error, call, $"{label} has no {required}, so it is not checked");
                leftOut = true;
            }
            if (leftOut) continue;

            var values = new Dictionary<string, string?>(StringComparer.Ordinal);
            IReadOnlyList<string> layers = [];
            foreach (var (parameter, expression) in args)
            {
                if (parameter == "layers")
                {
                    if (Strings(expression) is { } list) layers = list;
                    else
                    {
                        Problem(Unreadable, Severity.Error, expression,
                            $"the layers of {label} are written as `{Quote(expression)}`, which Stemma cannot read, so the rule is not checked. " +
                            "Write them as [\"…\", \"…\"] or new[] { \"…\" }, each a string literal or a const string declared in this file.");
                        leftOut = true;
                    }
                    continue;
                }
                if (DslConstants.TryRead(expression, null, out var value))
                {
                    values[parameter] = value;
                    if (value is null && shape.Required.Contains(parameter))
                    {
                        Problem(Unreadable, Severity.Error, expression, $"the {parameter} of {label} is null, so the rule is not checked");
                        leftOut = true;
                    }
                    continue;
                }
                if (parameter == "because")
                {
                    Problem(Unreadable, Severity.Warning, expression,
                        $"the because of {label} is written as `{Quote(expression)}`, which Stemma cannot read, so its violations give no reason. {Advice}");
                    continue;
                }
                Problem(Unreadable, Severity.Error, expression,
                    $"the {parameter} of {label} is written as `{Quote(expression)}`, which Stemma cannot read, so it is not checked. {Advice}");
                leftOut = true;
            }
            if (leftOut) continue;

            string? Value(string key) => values.GetValueOrDefault(key);
            switch (name)
            {
                case "Rule.Use":
                    var pack = Value("pack")!;
                    if (KnownPacks.Contains(pack, StringComparer.OrdinalIgnoreCase)) packs.Add(new(pack.ToLowerInvariant(), file, LineOf(call)));
                    else Problem(Unknown, Severity.Error, call, $"Rule.Use(\"{pack}\") names no pack Stemma has (known: {string.Join(", ", KnownPacks)}), so nothing is turned on");
                    continue;
                case "Code.At":
                    roots.Add(new(Value("path")!, file, LineOf(call)));
                    continue;
                case "Code.Map":
                    maps.Add(new(Value("id")!, Value("path")!, file, LineOf(call)));
                    continue;
            }

            var kind = Enum.Parse<DeclaredRuleKind>(method.Identifier.Text);
            var ok = true;
            ArchLinkKind? via = null;
            if (Value("via") is { } viaText)
            {
                if (viaText.Equals("dataFlow", StringComparison.OrdinalIgnoreCase)) via = ArchLinkKind.DataFlow;
                else if (viaText.Equals("dependency", StringComparison.OrdinalIgnoreCase)) via = ArchLinkKind.Dependency;
                else
                {
                    Problem(Unknown, Severity.Error, args["via"], $"{label} has via \"{viaText}\", which is not dataFlow or dependency, so it is not checked");
                    ok = false;
                }
            }
            var severity = kind == DeclaredRuleKind.Require ? Severity.Warning : Severity.Error;
            if (Value("severity") is { } severityText)
            {
                if (Enum.TryParse<Severity>(severityText, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed)) severity = parsed;
                else
                {
                    Problem(Unknown, Severity.Error, args["severity"], $"{label} has severity \"{severityText}\", which is not error, warning or info, so it is not checked");
                    ok = false;
                }
            }

            bool Selects(string? text, string parameter, SyntaxNode at, bool links = false)
            {
                if (text is null) return true;
                if (!links && text.TrimStart().StartsWith("link:", StringComparison.OrdinalIgnoreCase))
                {
                    Problem(BadSelector, Severity.Error, at,
                        $"the {parameter} of {label}, \"{text}\", selects links, which only a Require's of may; {kind} relates elements, so it is not checked");
                    return false;
                }
                if (Selector.TryParse(text, out _, out var error, allowNeighbours: false, allowLinks: links)) return true;
                Problem(BadSelector, Severity.Error, at,
                    $"the {parameter} of {label}, \"{text}\", is not a selector: {error.Message} (character {error.Position}), so the rule is not checked");
                return false;
            }

            ok &= Selects(Value("from"), "from", args.GetValueOrDefault("from") ?? (SyntaxNode)call);
            ok &= Selects(Value("to"), "to", args.GetValueOrDefault("to") ?? (SyntaxNode)call);
            for (var i = 0; i < layers.Count; i++)
                ok &= Selects(layers[i], $"layer {i + 1}", args.GetValueOrDefault("layers") ?? (SyntaxNode)call);
            if (kind == DeclaredRuleKind.Layers && layers.Count == 0)
            {
                Problem(Unreadable, Severity.Error, call, $"{label} has no layers, so it checks nothing");
                ok = false;
            }
            if (Value("of") is { } of && Selects(of, "of", args["of"], links: true))
            {
                var linkSelector = Selector.TryParse(of, out var parsedOf, out _, allowNeighbours: false, allowLinks: true) && parsedOf.IsLinkSelector;
                var has = Value("has")!;
                if (!(linkSelector ? LinkAttributes : ElementAttributes).Contains(has))
                {
                    Problem(Unknown, Severity.Error, args["has"],
                        $"{label} requires \"{has}\", which no {(linkSelector ? "link" : "element")} has (known: " +
                        $"{string.Join(", ", (linkSelector ? LinkAttributes : ElementAttributes).Order(StringComparer.Ordinal))}), so it is not checked");
                    ok = false;
                }
            }
            else if (kind == DeclaredRuleKind.Require) ok = false;
            if (!ok) continue;

            rules.Add(new DeclaredRule(kind, id!, Value("from"), Value("to"), layers, Value("of"), Value("has"),
                string.IsNullOrWhiteSpace(Value("because")) ? null : Value("because"), via, severity, file, LineOf(call)));
        }
        return new FileRules(rules, packs, roots, maps, problems);

        // Each argument by the parameter it is for: its name when it has one, else its position. A name
        // or a position the method does not have is said, and the call left unchecked.
        Dictionary<string, ExpressionSyntax>? Arguments(InvocationExpressionSyntax call, string name, string[] parameters)
        {
            var args = new Dictionary<string, ExpressionSyntax>(StringComparer.Ordinal);
            var list = call.ArgumentList.Arguments;
            for (var i = 0; i < list.Count; i++)
            {
                string? parameter;
                if (list[i].NameColon is { } named)
                {
                    parameter = parameters.FirstOrDefault(p => p.Equals(named.Name.Identifier.Text, StringComparison.OrdinalIgnoreCase));
                    if (parameter is null)
                    {
                        Problem(Unknown, Severity.Error, list[i],
                            $"{name} has no parameter '{named.Name.Identifier.Text}' (it takes {string.Join(", ", parameters)}), so it is not checked");
                        return null;
                    }
                }
                else if (i < parameters.Length) parameter = parameters[i];
                else
                {
                    Problem(Unknown, Severity.Error, list[i], $"{name} takes {parameters.Length} argument(s) ({string.Join(", ", parameters)}), so it is not checked");
                    return null;
                }
                args.TryAdd(parameter, list[i].Expression);
            }
            return args;
        }
    }

    /// <summary><c>Rule</c> in <c>Rule.Forbid</c>, <c>Stemma.Model.Rule.Forbid</c> or <c>global::Stemma.Model.Rule.Forbid</c>.</summary>
    private static string? OwnerName(ExpressionSyntax owner) => owner switch
    {
        IdentifierNameSyntax id => id.Identifier.Text,
        MemberAccessExpressionSyntax { Name: IdentifierNameSyntax id } => id.Identifier.Text,
        AliasQualifiedNameSyntax { Name: IdentifierNameSyntax id } => id.Identifier.Text,
        _ => null,
    };

    /// <summary>A list of strings written <c>[ … ]</c>, <c>new[] { … }</c> or <c>new string[] { … }</c>, each readable; null otherwise.</summary>
    private static IReadOnlyList<string>? Strings(ExpressionSyntax expression)
    {
        IEnumerable<ExpressionSyntax>? items = expression switch
        {
            CollectionExpressionSyntax c => c.Elements.All(e => e is ExpressionElementSyntax)
                ? c.Elements.Cast<ExpressionElementSyntax>().Select(e => e.Expression)
                : null,
            ImplicitArrayCreationExpressionSyntax a => a.Initializer.Expressions,
            ArrayCreationExpressionSyntax { Initializer: { } init } => init.Expressions,
            _ => null,
        };
        if (items is null) return null;
        var values = new List<string>();
        foreach (var item in items)
        {
            if (!DslConstants.TryRead(item, null, out var value) || value is null) return null;
            values.Add(value);
        }
        return values;
    }

    private static int LineOf(SyntaxNode node) => node.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

    /// <summary>The argument as written, on one line and short enough to quote in a sentence.</summary>
    private static string Quote(ExpressionSyntax expression)
    {
        var lines = expression.ToString().Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        var text = string.Join(" ", lines.Select(l => l.Trim()));
        return text.Length <= 60 ? text : text[..59] + "…";
    }
}
