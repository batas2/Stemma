using System.Diagnostics.CodeAnalysis;

namespace Stemma.Engine.ArchModel;

/// <summary>A selector that could not be read, and where.</summary>
/// <param name="Position">1-based: the character an editor's column would show for the fault.</param>
public sealed record SelectorError(int Position, string Message);

/// <summary>
/// One selector of the language a view's <c>Include</c> and <c>Exclude</c> are written in
/// (ADR-0026), parsed, and evaluated against a model as a pure function of it:
///
/// <code>
/// selector   := neighbours | base
/// neighbours := "->" base | base "->" | "->" base "->"
/// base       := ( "*" | id | id ".*" | "kind:" kind ) filter*
/// filter     := "[" attr ( "=" | "!=" ) value ( "|" value )* "]"
/// </code>
///
/// <c>*</c> is every element; <c>id.*</c> the element's children — a system's containers, a context's
/// modules and capabilities; <c>kind:container</c> every element of that kind. A filter keeps what an
/// attribute says (<c>[technology=PostgreSQL]</c>), what it does not (<c>[status!=deprecated]</c>), or one
/// of several (<c>[kind=db|cache]</c>). Attributes are the element's constructor arguments, with their
/// defaults (a container written without its kind is a <c>service</c>), its <c>id</c> and <c>name</c>,
/// and <c>status</c> and <c>phase</c> from its lifecycle and <c>squad</c> and <c>domain</c> from its
/// ownership. Kinds and attribute names match whatever their case, and values compare whatever theirs;
/// ids are exact, as they are everywhere else. <c>->X</c> is X and what relates to it, <c>X-></c> X and
/// what it relates to, <c>->X-></c> both — over links of any kind.
///
/// The same language reads rules (ADR-0028), which have no neighbourhood: those forms can be refused
/// when parsing.
/// </summary>
public sealed class Selector
{
    private enum BaseKind { All, Id, Children, OfKind }

    private sealed record Filter(string Attribute, bool Negated, IReadOnlyList<string> Values);

    private readonly BaseKind _base;
    private readonly string? _id;
    private readonly ArchElementKind? _kind;
    private readonly IReadOnlyList<Filter> _filters;
    private readonly bool _incoming;
    private readonly bool _outgoing;

    private Selector(string text, BaseKind @base, string? id, ArchElementKind? kind, IReadOnlyList<Filter> filters, bool incoming, bool outgoing)
    {
        Text = text;
        _base = @base;
        _id = id;
        _kind = kind;
        _filters = filters;
        _incoming = incoming;
        _outgoing = outgoing;
    }

    /// <summary>The selector as it was written.</summary>
    public string Text { get; }

    /// <summary>
    /// The id the selector is about — <c>x</c>, <c>x.*</c>, <c>->x</c>, filtered or not — or null for
    /// <c>*</c> and <c>kind:</c>. An id that is not in the model is a typo, not an empty selection.
    /// </summary>
    public string? NamedId => _base is BaseKind.Id or BaseKind.Children ? _id : null;

    /// <summary>Whether the selector is an id and nothing more.</summary>
    public bool IsPlainId => _base == BaseKind.Id && _filters.Count == 0 && !_incoming && !_outgoing;

    /// <summary>
    /// Read <paramref name="text"/> as a selector. Refused, <paramref name="error"/> says what is wrong
    /// and at which character.
    /// </summary>
    /// <param name="allowNeighbours">False where <c>->X</c> means nothing, as in a rule.</param>
    public static bool TryParse(string text, [NotNullWhen(true)] out Selector? selector, [NotNullWhen(false)] out SelectorError? error, bool allowNeighbours = true)
    {
        selector = null;
        try
        {
            selector = new Parser(text, allowNeighbours).Parse();
            error = null;
            return true;
        }
        catch (SelectorSyntaxException e)
        {
            error = new SelectorError(e.Position + 1, e.Message);
            return false;
        }
    }

    /// <summary>The ids of the elements this selector selects, in the order the model declares them.</summary>
    public IReadOnlyList<string> Select(ArchModel model) => Select(new SelectorScope(model));

    internal IReadOnlyList<string> Select(SelectorScope scope)
    {
        IEnumerable<ArchElement> candidates = _base switch
        {
            BaseKind.All => scope.Elements,
            BaseKind.Id => scope.Element(_id!) is { } e ? [e] : [],
            BaseKind.Children => scope.ChildrenOf(_id!),
            _ => scope.Elements.Where(e => e.Kind == _kind),
        };
        var selected = candidates.Where(e => _filters.All(f => Matches(scope, e, f))).Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
        if (_incoming || _outgoing)
        {
            var around = selected.ToList();
            foreach (var id in around)
            {
                if (_incoming) selected.UnionWith(scope.RelatingTo(id));
                if (_outgoing) selected.UnionWith(scope.RelatedFrom(id));
            }
        }
        return scope.InModelOrder(selected);
    }

    private static bool Matches(SelectorScope scope, ArchElement element, Filter filter)
    {
        var value = scope.Attribute(element, filter.Attribute);
        var any = value is not null && filter.Values.Any(v => string.Equals(v, value, StringComparison.OrdinalIgnoreCase));
        return filter.Negated ? !any : any;
    }

    private sealed class SelectorSyntaxException(int position, string message) : Exception(message)
    {
        public int Position { get; } = position;
    }

    /// <summary>A hand-written recursive descent over the grammar, keeping the position of every fault.</summary>
    private sealed class Parser(string text, bool allowNeighbours)
    {
        private int _at;

        public Selector Parse()
        {
            SkipSpace();
            var incoming = Arrow();
            SkipSpace();
            if (_at >= text.Length) throw Fault("expected an id, *, or kind:<kind>");

            BaseKind @base;
            string? id = null;
            ArchElementKind? kind = null;
            if (text[_at] == '*')
            {
                @base = BaseKind.All;
                _at++;
            }
            else if (text.AsSpan(_at).StartsWith("kind:", StringComparison.OrdinalIgnoreCase))
            {
                _at += "kind:".Length;
                var start = _at;
                while (_at < text.Length && char.IsLetterOrDigit(text[_at])) _at++;
                var name = text[start.._at];
                if (name.Length == 0) throw Fault("expected a kind after kind:");
                if (!Enum.TryParse<ArchElementKind>(name, ignoreCase: true, out var parsed) || !Enum.IsDefined(parsed) || char.IsDigit(name[0]))
                    throw new SelectorSyntaxException(start, $"unknown kind '{name}' (known: {string.Join(", ", Enum.GetNames<ArchElementKind>().Select(Camel))})");
                kind = parsed;
                @base = BaseKind.OfKind;
            }
            else if (IsIdChar(text[_at]))
            {
                var start = _at;
                while (_at < text.Length && IsIdChar(text[_at]) && !At("->") && !At(".*")) _at++;
                id = text[start.._at];
                if (id.Length == 0) throw Fault($"unexpected '{text[_at]}': a selector starts with an id, *, or kind:<kind>");
                if (At(".*"))
                {
                    _at += 2;
                    @base = BaseKind.Children;
                }
                else @base = BaseKind.Id;
            }
            else throw Fault($"unexpected '{text[_at]}': a selector starts with an id, *, or kind:<kind>");

            var filters = new List<Filter>();
            SkipSpace();
            while (_at < text.Length && text[_at] == '[')
            {
                filters.Add(ParseFilter());
                SkipSpace();
            }

            var outgoing = Arrow();
            SkipSpace();
            if (_at < text.Length) throw Fault($"unexpected '{text[_at]}'");
            return new Selector(text, @base, id, kind, filters, incoming, outgoing);
        }

        private Filter ParseFilter()
        {
            var open = _at;
            _at++;
            SkipSpace();
            var start = _at;
            while (_at < text.Length && (char.IsLetterOrDigit(text[_at]) || text[_at] == '_')) _at++;
            var attribute = text[start.._at];
            if (attribute.Length == 0) throw Fault("expected an attribute name after [");
            SkipSpace();
            bool negated;
            if (At("!=")) { negated = true; _at += 2; }
            else if (_at < text.Length && text[_at] == '=') { negated = false; _at++; }
            else throw Fault($"expected = or != after '{attribute}'");

            var values = new List<string>();
            while (true)
            {
                var valueStart = _at;
                while (_at < text.Length && text[_at] is not ('|' or ']')) _at++;
                var value = text[valueStart.._at].Trim();
                if (value.Length == 0) throw new SelectorSyntaxException(valueStart, "expected a value");
                values.Add(value);
                if (_at >= text.Length) throw new SelectorSyntaxException(open, "this [ is never closed");
                if (text[_at++] == ']') break;
            }
            return new Filter(attribute, negated, values);
        }

        private bool Arrow()
        {
            if (!At("->")) return false;
            if (!allowNeighbours) throw Fault("-> is not allowed here: neighbours are for views, not rules");
            _at += 2;
            return true;
        }

        private bool At(string token) => text.AsSpan(_at).StartsWith(token, StringComparison.Ordinal);

        private void SkipSpace()
        {
            while (_at < text.Length && char.IsWhiteSpace(text[_at])) _at++;
        }

        private SelectorSyntaxException Fault(string message) => new(_at, message);

        private static bool IsIdChar(char c) => char.IsLetterOrDigit(c) || c is '_' or '-' or '.' or ':';

        private static string Camel(string name) => char.ToLowerInvariant(name[0]) + name[1..];
    }
}

/// <summary>
/// What evaluating selectors against one model needs, worked out once: each element's attributes as
/// a selector reads them, each element's children, and who relates to whom.
/// </summary>
internal sealed class SelectorScope
{
    private readonly Dictionary<string, ArchElement> _byId = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _order = new(StringComparer.Ordinal);
    private readonly List<ArchElement> _elements = [];
    private readonly Dictionary<string, List<ArchElement>> _children = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<string>> _incoming = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<string>> _outgoing = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Dictionary<string, string>> _attributes = new(StringComparer.Ordinal);

    public SelectorScope(ArchModel model)
    {
        Model = model;
        foreach (var e in model.Elements)
        {
            if (!_byId.TryAdd(e.Id, e)) continue;
            _order[e.Id] = _order.Count;
            _elements.Add(e);
        }
        foreach (var e in Elements)
            foreach (var parent in new[] { "systemId", "contextId" })
                if (e.Attributes.GetValueOrDefault(parent) is { Length: > 0 } p)
                    (_children.TryGetValue(p, out var list) ? list : _children[p] = []).Add(e);
        foreach (var link in model.Links)
        {
            if (!_byId.ContainsKey(link.FromId) || !_byId.ContainsKey(link.ToId)) continue;
            (_incoming.TryGetValue(link.ToId, out var into) ? into : _incoming[link.ToId] = []).Add(link.FromId);
            (_outgoing.TryGetValue(link.FromId, out var outOf) ? outOf : _outgoing[link.FromId] = []).Add(link.ToId);
        }
        foreach (var tag in model.Tags)
        {
            if (!_byId.ContainsKey(tag.TargetId)) continue;
            var attributes = _attributes.TryGetValue(tag.TargetId, out var a) ? a : _attributes[tag.TargetId] = new(StringComparer.OrdinalIgnoreCase);
            foreach (var (name, value) in new[]
                     {
                         ("status", tag.Lifecycle?.Status), ("phase", tag.Lifecycle?.Phase),
                         ("squad", tag.Ownership?.Squad), ("domain", tag.Ownership?.Domain),
                     })
                if (value is not null) attributes.TryAdd(name, value);
        }
    }

    public ArchModel Model { get; }

    /// <summary>Every element, the first of an id only, in the order the model declares them.</summary>
    public IReadOnlyList<ArchElement> Elements => _elements;

    public ArchElement? Element(string id) => _byId.GetValueOrDefault(id);

    public IEnumerable<ArchElement> ChildrenOf(string id) => _children.GetValueOrDefault(id) ?? [];

    /// <summary>The elements with a link to <paramref name="id"/>.</summary>
    public IEnumerable<string> RelatingTo(string id) => _incoming.GetValueOrDefault(id) ?? [];

    /// <summary>The elements <paramref name="id"/> has a link to.</summary>
    public IEnumerable<string> RelatedFrom(string id) => _outgoing.GetValueOrDefault(id) ?? [];

    public IReadOnlyList<string> InModelOrder(IEnumerable<string> ids) =>
        ids.Where(_order.ContainsKey).Distinct(StringComparer.Ordinal).OrderBy(id => _order[id]).ToList();

    /// <summary>An attribute as a selector reads it: written, defaulted, or carried by a tag.</summary>
    public string? Attribute(ArchElement element, string name)
    {
        if (name.Equals("id", StringComparison.OrdinalIgnoreCase)) return element.Id;
        if (name.Equals("name", StringComparison.OrdinalIgnoreCase)) return element.Name;
        foreach (var (key, value) in element.Attributes)
            if (key.Equals(name, StringComparison.OrdinalIgnoreCase)) return value;
        var parameter = DslVocabulary.ParametersOf(element.Kind.ToString())?.FirstOrDefault(p => p.Equals(name, StringComparison.OrdinalIgnoreCase));
        if (parameter is not null && DslVocabulary.DefaultOf(element.Kind.ToString(), parameter) is { } byDefault) return byDefault;
        return _attributes.GetValueOrDefault(element.Id)?.GetValueOrDefault(name);
    }
}
