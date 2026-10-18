using System.Text.Json;
using Microsoft.CodeAnalysis.CSharp;
using Stemma.Engine.ArchModel;
using Stemma.Engine.Workspace;

namespace Stemma.Cli;

public enum CheckSeverity { Error, Warning, Info }

/// <summary>One thing that is wrong, or worth knowing, about a workspace.</summary>
public sealed record CheckFinding(CheckSeverity Severity, string Rule, string Message, string? ElementId = null);

/// <summary>
/// The checks the C# compiler cannot make.
///
/// Ids in flows, dependencies, `AboutId`, views and books are strings, and nothing verifies them at
/// build time or at run time — a typo produces a missing node, a missing edge or a page pointing at
/// nothing, silently. For someone working in the canvas that is a puzzle; for an agent that never
/// sees the picture it is invisible, and it renders a diagram that is quietly wrong rather than
/// failing.
///
/// So this is written for a reader who cannot look: every finding names the rule, the element and
/// what to do, and the exit code distinguishes "this is broken" from "this is unusual".
/// </summary>
public static class WorkspaceCheck
{
    /// <summary>Above this many boxes a diagram has stopped answering one question. From the blog's
    /// own house style, and a warning rather than an error because it is a rule of thumb.</summary>
    public const int BusyViewThreshold = 7;

    public static IReadOnlyList<CheckFinding> Run(string workspaceRoot)
    {
        var findings = new List<CheckFinding>();

        var archPath = Path.Combine(workspaceRoot, "Architecture", "Architecture.cs");
        if (!File.Exists(archPath))
        {
            findings.Add(new(CheckSeverity.Error, "workspace/no-model",
                $"no model at {Path.Combine("Architecture", "Architecture.cs")} — is this a Stemma workspace?"));
            return findings;
        }

        var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(archPath));
        var model = DslReader.TryRead(archPath, tree.GetRoot());
        if (model is null)
        {
            findings.Add(new(CheckSeverity.Error, "model/unreadable",
                "Architecture.cs has no parseable `public static Model Build()` — the engine reads exactly that name."));
            return findings;
        }

        var ids = model.Elements.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
        var views = ReadViews(workspaceRoot);
        findings.AddRange(DuplicateIds(model));
        findings.AddRange(DanglingLinkEndpoints(model, ids));
        findings.AddRange(DanglingAttributeReferences(model, ids));
        findings.AddRange(RegisterFindings(model));
        findings.AddRange(ViewFindings(views, model, ids));
        findings.AddRange(ShapeFindings(workspaceRoot, ids));
        findings.AddRange(ConstraintFindings(workspaceRoot, ids));
        findings.AddRange(BookFindings(workspaceRoot, views, ids));
        findings.AddRange(HeaderFindings(workspaceRoot, views, model));
        findings.AddRange(LegacyBookFindings(workspaceRoot));

        return findings;
    }

    /// <summary>The views declared in <c>Views/*.cs</c>, read once for every check that names them.</summary>
    private static IReadOnlyList<ArchView> ReadViews(string workspaceRoot)
    {
        var viewsDir = Path.Combine(workspaceRoot, "Views");
        if (!Directory.Exists(viewsDir)) return [];

        var docs = Directory.EnumerateFiles(viewsDir, "*.cs", SearchOption.AllDirectories)
            .Select(f => (FilePath: f, Root: (Microsoft.CodeAnalysis.SyntaxNode)CSharpSyntaxTree.ParseText(File.ReadAllText(f)).GetRoot()));
        return ViewsAdapter.ReadAllFrom(docs);
    }

    /// <summary>
    /// Books written before ADR-0022 lived in <c>Concepts/view-book.stemma.yaml</c>, and Stemma no
    /// longer reads that file. Without this the books in it simply stop appearing, and nothing says
    /// where they went.
    /// </summary>
    private static IEnumerable<CheckFinding> LegacyBookFindings(string workspaceRoot)
    {
        if (!File.Exists(Path.Combine(workspaceRoot, "Concepts", "view-book.stemma.yaml"))) yield break;
        yield return new(CheckSeverity.Warning, "book/legacy-file",
            "Concepts/view-book.stemma.yaml is no longer read — books now live in stemma.layout.json under `books` " +
            "(ADR-0022); move them there, or the app shows none of them");
    }

    /// <summary>The views a page may show without a file in <c>Views/</c>: the canvas's own lenses.</summary>
    private static readonly HashSet<string> BuiltInViews =
        new(StringComparer.Ordinal) { "moduleMap", "dependencyGraph" };

    /// <summary>The prefix a code view's key has under <c>views</c>, and that a page's <c>view</c> does not.</summary>
    private const string CustomViewKey = "custom:";

    /// <summary>
    /// Books: the walks through the model kept in the sidecar's `books` section (ADR-0022, F-013).
    ///
    /// A page names the view it shows and the elements it points at, and both are strings in a
    /// presentation file that nothing else checks. The compiler never sees the sidecar, the engine
    /// stores the section without reading it, and the canvas marks a broken page only for someone who
    /// opens that page. A slide that outlives the element it points at is the drift Stemma exists to
    /// prevent: the deck still presents, and tells the room something about a system that is no
    /// longer true.
    /// </summary>
    private static IEnumerable<CheckFinding> BookFindings(string workspaceRoot, IReadOnlyList<ArchView> views, HashSet<string> elementIds)
    {
        var path = LayoutSidecar.PathFor(workspaceRoot);
        if (!File.Exists(path)) yield break;

        JsonDocument? doc = null;
        try { doc = JsonDocument.Parse(File.ReadAllText(path)); }
        catch (JsonException) { yield break; }   // already reported by ShapeFindings

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object) yield break;
            if (!doc.RootElement.TryGetProperty("books", out var books) || books.ValueKind == JsonValueKind.Null) yield break;

            if (books.ValueKind != JsonValueKind.Object)
            {
                yield return MalformedBook("`books` in stemma.layout.json is not an object keyed by book id, so the canvas shows no books at all");
                yield break;
            }

            // A view declared twice is already reported elsewhere as arbitrary; the first one stands.
            var viewMembers = views
                .GroupBy(v => v.Id, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.First().ElementIds.ToHashSet(StringComparer.Ordinal), StringComparer.Ordinal);

            foreach (var book in books.EnumerateObject())
            {
                if (book.Value.ValueKind != JsonValueKind.Object)
                {
                    yield return MalformedBook($"book '{book.Name}' is not an object, so the canvas skips it");
                    continue;
                }
                if (!book.Value.TryGetProperty("pages", out var pages) || pages.ValueKind != JsonValueKind.Object)
                {
                    yield return MalformedBook($"book '{book.Name}' has no `pages` object keyed by page id, so it has nothing to present");
                    continue;
                }

                var pageIds = new HashSet<string>(StringComparer.Ordinal);
                foreach (var page in pages.EnumerateObject())
                {
                    pageIds.Add(page.Name);
                    foreach (var finding in PageFindings(book.Name, page, viewMembers, elementIds)) yield return finding;
                }

                foreach (var finding in OrderFindings(book.Name, book.Value, pageIds)) yield return finding;
            }
        }
    }

    /// <summary>
    /// One page's references: the view it shows, and the elements it points at in that view.
    ///
    /// A focus outside a code view is a warning rather than an error: the element exists, so the page
    /// is not broken, but the view does not draw it and there is nothing on the slide to light up.
    /// The built-in views draw every element, so they are not checked.
    /// </summary>
    private static IEnumerable<CheckFinding> PageFindings(
        string book, JsonProperty page, Dictionary<string, HashSet<string>> views, HashSet<string> elementIds)
    {
        var where = $"book '{book}' page '{page.Name}'";
        if (page.Value.ValueKind != JsonValueKind.Object)
        {
            yield return MalformedBook($"{where} is not an object, so the book presents without it");
            yield break;
        }

        var hasTitle = page.Value.TryGetProperty("title", out var title) && title.ValueKind == JsonValueKind.String;
        var view = page.Value.TryGetProperty("view", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : null;
        if (!hasTitle || view is null)
        {
            var missing = string.Join(" or ", new[] { hasTitle ? null : "`title`", view is null ? "`view`" : null }.OfType<string>());
            yield return MalformedBook(
                $"{where} has no {missing} written as a string; every page needs a title and a view, and nothing else on this one was checked");
            yield break;
        }

        HashSet<string>? members = null;
        if (!BuiltInViews.Contains(view) && !views.TryGetValue(view, out members))
        {
            var bare = view.StartsWith(CustomViewKey, StringComparison.Ordinal) ? view[CustomViewKey.Length..] : null;
            var hint = bare is not null && views.ContainsKey(bare)
                ? $" (write '{bare}': '{CustomViewKey}' is the view's key under `views`, not its id)"
                : $" (a page shows {string.Join(", ", BuiltInViews.Order())} or the id of a view in Views/)";
            yield return new(CheckSeverity.Error, "book/missing-view",
                $"{where} shows view '{view}', which does not exist, so the page has no picture to show{hint}");
        }

        if (!page.Value.TryGetProperty("focus", out var focus) || focus.ValueKind == JsonValueKind.Null) yield break;
        if (focus.ValueKind != JsonValueKind.Array)
        {
            yield return MalformedBook($"{where} has a `focus` that is not a list of element ids, so the page points at nothing");
            yield break;
        }

        var focused = focus.EnumerateArray()
            .Where(e => e.ValueKind == JsonValueKind.String)
            .Select(e => e.GetString()!)
            .Distinct(StringComparer.Ordinal);
        foreach (var id in focused)
        {
            if (!elementIds.Contains(id))
                yield return new(CheckSeverity.Error, "book/dangling-focus",
                    $"{where} points at '{id}', which is not an element in the model, so the page is marked broken and what its narrative talks about is not on the slide", id);
            else if (members is not null && !members.Contains(id))
                yield return new(CheckSeverity.Warning, "book/focus-outside-view",
                    $"{where} points at '{id}', which view '{view}' does not include, so there is nothing on the slide to light up for it", id);
        }
    }

    /// <summary>Page ids in a book's `order` with no page: the presenter skips them, and nothing says why.</summary>
    private static IEnumerable<CheckFinding> OrderFindings(string book, JsonElement value, HashSet<string> pageIds)
    {
        if (!value.TryGetProperty("order", out var order) || order.ValueKind == JsonValueKind.Null) yield break;
        if (order.ValueKind != JsonValueKind.Array)
        {
            yield return MalformedBook($"book '{book}' has an `order` that is not a list of page ids, so its pages are presented in file order");
            yield break;
        }

        var listed = order.EnumerateArray()
            .Where(e => e.ValueKind == JsonValueKind.String)
            .Select(e => e.GetString()!)
            .Distinct(StringComparer.Ordinal);
        foreach (var id in listed.Where(id => !pageIds.Contains(id)))
            yield return new(CheckSeverity.Warning, "book/dangling-order",
                $"book '{book}' lists '{id}' in its `order` but has no page '{id}', so the presenter skips it; restore the page or take it out of the order");
    }

    private static CheckFinding MalformedBook(string message) => new(CheckSeverity.Warning, "book/malformed", message);

    /// <summary>
    /// A view's header (F-014, ADR-0023): its title, message, context and legend, under
    /// `views.&lt;key&gt;.header`.
    ///
    /// The canvas reads a header tolerantly — a field of the wrong type is ignored, a legend entry it
    /// does not understand is skipped — so a typo there never breaks a view; it quietly leaves the
    /// words off the slide. This says which. A legend entry naming a status no element in the view
    /// carries is drawn as a plain swatch, which is a key to nothing.
    /// </summary>
    private static IEnumerable<CheckFinding> HeaderFindings(string workspaceRoot, IReadOnlyList<ArchView> views, ArchModel model)
    {
        var path = LayoutSidecar.PathFor(workspaceRoot);
        if (!File.Exists(path)) yield break;

        JsonDocument? doc = null;
        try { doc = JsonDocument.Parse(File.ReadAllText(path)); }
        catch (JsonException) { yield break; }   // already reported by ShapeFindings

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object) yield break;
            if (!doc.RootElement.TryGetProperty("views", out var viewEntries) || viewEntries.ValueKind != JsonValueKind.Object) yield break;

            var codeViews = views
                .GroupBy(v => v.Id, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
            var statusOf = model.Tags
                .Where(t => t.Lifecycle?.Status is not null)
                .GroupBy(t => t.TargetId, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.First().Lifecycle!.Status!, StringComparer.Ordinal);

            foreach (var entry in viewEntries.EnumerateObject())
            {
                if (entry.Value.ValueKind != JsonValueKind.Object) continue;
                if (!entry.Value.TryGetProperty("header", out var header) || header.ValueKind == JsonValueKind.Null) continue;
                var where = $"view '{entry.Name}'";
                if (header.ValueKind != JsonValueKind.Object)
                {
                    yield return MalformedHeader($"{where} has a `header` that is not an object, so the canvas shows no header for it");
                    continue;
                }

                foreach (var field in new[] { "title", "message", "context" })
                {
                    if (header.TryGetProperty(field, out var value) && value.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
                        yield return MalformedHeader($"{where} has a header `{field}` that is not text, so it is left out of the header");
                }

                if (!header.TryGetProperty("legend", out var legend) || legend.ValueKind == JsonValueKind.Null) continue;
                if (legend.ValueKind != JsonValueKind.Array)
                {
                    yield return MalformedHeader($"{where} has a header `legend` that is not a list, so the legend is computed from the view instead");
                    continue;
                }

                var carried = StatusesDrawn(entry.Name, codeViews, model, statusOf);
                var index = 0;
                foreach (var item in legend.EnumerateArray())
                {
                    index++;
                    var status = item.ValueKind == JsonValueKind.Object && item.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.String ? st.GetString() : null;
                    if (status is not null)
                    {
                        if (carried is not null && !carried.Contains(status))
                            yield return new(CheckSeverity.Warning, "header/unknown-status",
                                $"{where} has a legend entry for status '{status}', which no element in the view carries, so its swatch is drawn plain and keys nothing");
                        continue;
                    }
                    var labelled = item.ValueKind == JsonValueKind.Object && item.TryGetProperty("label", out var label) && label.ValueKind == JsonValueKind.String;
                    var drawn = item.ValueKind == JsonValueKind.Object
                        && ((item.TryGetProperty("swatch", out var sw) && sw.ValueKind == JsonValueKind.Object)
                            || (item.TryGetProperty("line", out var ln) && ln.ValueKind == JsonValueKind.Object));
                    if (!labelled || !drawn)
                        yield return MalformedHeader(
                            $"{where} has legend entry {index} that is none of `{{ status }}`, `{{ swatch, label }}` or `{{ line, label }}`, so the legend leaves it out");
                }
            }
        }
    }

    /// <summary>The statuses carried by the elements a view draws, or null when the view is not known here.</summary>
    private static HashSet<string>? StatusesDrawn(
        string viewKey, Dictionary<string, ArchView> codeViews, ArchModel model, Dictionary<string, string> statusOf)
    {
        IEnumerable<ArchElement> drawn;
        if (viewKey == "moduleMap") drawn = model.Elements.Where(e => e.Kind != ArchElementKind.Concept);
        else if (viewKey == "dependencyGraph") drawn = model.Elements.Where(e => e.Kind is ArchElementKind.Module or ArchElementKind.BoundedContext or ArchElementKind.Capability);
        else if (viewKey.StartsWith(CustomViewKey, StringComparison.Ordinal) && codeViews.TryGetValue(viewKey[CustomViewKey.Length..], out var view))
        {
            // Through the view's base lens, as the canvas draws it: the dependency lens keeps only
            // modules, contexts and capabilities, whatever else the view names.
            var members = view.ElementIds.ToHashSet(StringComparer.Ordinal);
            drawn = model.Elements.Where(e => members.Contains(e.Id)
                && (view.BaseView != "dependencyGraph" || e.Kind is ArchElementKind.Module or ArchElementKind.BoundedContext or ArchElementKind.Capability));
        }
        else return null;
        return drawn.Select(e => statusOf.GetValueOrDefault(e.Id)).OfType<string>().ToHashSet(StringComparer.Ordinal);
    }

    private static CheckFinding MalformedHeader(string message) => new(CheckSeverity.Warning, "header/malformed", message);

    private static readonly HashSet<string> ConstraintKinds =
        new(StringComparer.Ordinal) { "grid", "row", "column", "stack" };

    /// <summary>
    /// The `layout` constraint, which is the part of the sidecar most often written by hand.
    ///
    /// A constraint is not validated by anything else: the canvas solves whatever it is given, and a
    /// wrong *type* is the mistake that actually happens — `gap: [56, 30]` is right for a grid and
    /// wrong for a row, and the two sit three lines apart in the same document. The solver now
    /// falls back to its default instead of producing coordinates that are not numbers, which turns
    /// a failed render into a silently different picture. This is what says so out loud.
    /// </summary>
    private static IEnumerable<CheckFinding> ConstraintFindings(string workspaceRoot, HashSet<string> elementIds)
    {
        var path = LayoutSidecar.PathFor(workspaceRoot);
        if (!File.Exists(path)) yield break;

        JsonDocument? doc = null;
        try { doc = JsonDocument.Parse(File.ReadAllText(path)); }
        catch (JsonException) { yield break; }   // already reported by ShapeFindings

        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("views", out var views) || views.ValueKind != JsonValueKind.Object)
                yield break;

            foreach (var view in views.EnumerateObject())
            {
                if (view.Value.ValueKind != JsonValueKind.Object) continue;
                if (!view.Value.TryGetProperty("layout", out var layout)) continue;
                if (layout.ValueKind == JsonValueKind.Null) continue;

                if (layout.ValueKind != JsonValueKind.Object)
                {
                    yield return new(CheckSeverity.Error, "constraint/not-an-object",
                        $"view '{view.Name}' has a `layout` that is not an object, so no arrangement is applied");
                    continue;
                }

                var kind = layout.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String
                    ? k.GetString() : null;

                if (kind is null || !ConstraintKinds.Contains(kind))
                {
                    yield return new(CheckSeverity.Error, "constraint/unknown-kind",
                        $"view '{view.Name}' has a layout of kind '{kind ?? "(none)"}', which the canvas does not solve, " +
                        $"so the view falls back to stored positions (known: {string.Join(", ", ConstraintKinds.Order())})");
                    continue;
                }

                foreach (var finding in GapFindings(view.Name, kind, layout)) yield return finding;
                foreach (var finding in MemberFindings(view.Name, kind, layout, elementIds)) yield return finding;
            }
        }
    }

    /// <summary>
    /// The spacing field, checked against the shape the kind's solver reads.
    ///
    /// A single number is accepted everywhere — it is unambiguous and reads naturally — so the only
    /// thing reported is a value the solver cannot use at all, including the pair that belongs to a
    /// grid appearing on a row.
    /// </summary>
    private static IEnumerable<CheckFinding> GapFindings(string view, string kind, JsonElement layout)
    {
        var name = kind == "stack" ? "step" : "gap";
        if (!layout.TryGetProperty(name, out var gap) || gap.ValueKind == JsonValueKind.Null) yield break;
        if (gap.ValueKind == JsonValueKind.Number) yield break;

        var takesPair = kind is "grid" or "stack";
        var isPair = gap.ValueKind == JsonValueKind.Array
            && gap.GetArrayLength() == 2
            && gap.EnumerateArray().All(v => v.ValueKind == JsonValueKind.Number);
        if (takesPair && isPair) yield break;

        yield return new(CheckSeverity.Error, "constraint/bad-gap",
            $"view '{view}' has a {kind} `{name}` the canvas cannot use, so it falls back to its default " +
            $"spacing and the picture is not the one the file describes " +
            (takesPair ? $"(a {kind} takes [x, y] or one number)" : $"(a {kind} takes one number)"));
    }

    /// <summary>Ids a constraint places that the model does not have — a typo nothing else reports.</summary>
    private static IEnumerable<CheckFinding> MemberFindings(string view, string kind, JsonElement layout, HashSet<string> elementIds)
    {
        var member = kind == "grid" ? "columns" : "ids";
        if (!layout.TryGetProperty(member, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            yield return new(CheckSeverity.Error, "constraint/no-members",
                $"view '{view}' has a {kind} layout with no `{member}` array, so it places nothing");
            yield break;
        }

        var placed = (kind == "grid"
                ? value.EnumerateArray().Where(c => c.ValueKind == JsonValueKind.Array).SelectMany(c => c.EnumerateArray())
                : value.EnumerateArray())
            .Where(v => v.ValueKind == JsonValueKind.String)
            .Select(v => v.GetString()!)
            .ToList();

        if (placed.Count == 0)
            yield return new(CheckSeverity.Warning, "constraint/no-members",
                $"view '{view}' has a {kind} layout that places no elements");

        foreach (var id in placed.Distinct(StringComparer.Ordinal).Where(id => !elementIds.Contains(id)))
            yield return new(CheckSeverity.Error, "constraint/dangling-id",
                $"view '{view}' arranges '{id}', which is not an element in the model; it is placed by the constraint and drawn by nothing", id);
    }

    /// <summary>Matches `MAX_SHAPES_PER_VIEW` in the canvas, which stops drawing past it.</summary>
    public const int MaxShapesPerView = 256;

    private static readonly HashSet<string> ShapeKinds =
        new(StringComparer.Ordinal) { "rect", "ellipse", "triangle", "label", "arrow", "image" };

    /// <summary>
    /// Free-form annotation, checked because it is now authored by hand.
    ///
    /// Shapes are pure presentation and the engine deliberately does not model them, so nothing else
    /// looks at them at all: an arrow anchored to an element that was renamed simply detaches and
    /// falls back to its snapshot coordinates, which looks like a diagram someone drew carelessly
    /// rather than like a broken reference.
    /// </summary>
    private static IEnumerable<CheckFinding> ShapeFindings(string workspaceRoot, HashSet<string> elementIds)
    {
        var path = LayoutSidecar.PathFor(workspaceRoot);
        if (!File.Exists(path)) yield break;

        JsonDocument? doc = null;
        try { doc = JsonDocument.Parse(File.ReadAllText(path)); }
        catch (JsonException) { /* reported below — a yield cannot live in a catch */ }

        if (doc is null)
        {
            yield return new(CheckSeverity.Warning, "sidecar/unreadable",
                "stemma.layout.json does not parse; the canvas ignores it, so every position and annotation in it is lost");
            yield break;
        }

        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("views", out var views)) yield break;

            foreach (var view in views.EnumerateObject())
            {
                if (!view.Value.TryGetProperty("shapes", out var shapes) || shapes.ValueKind != JsonValueKind.Array) continue;

                var all = shapes.EnumerateArray().ToList();
                var shapeIds = all
                    .Select(s => s.TryGetProperty("id", out var id) ? id.GetString() : null)
                    .Where(id => id is not null).Select(id => id!)
                    .ToHashSet(StringComparer.Ordinal);

                if (all.Count > MaxShapesPerView)
                    yield return new(CheckSeverity.Warning, "shape/too-many",
                        $"view '{view.Name}' has {all.Count} shapes; the canvas stops drawing past {MaxShapesPerView}");

                foreach (var shape in all)
                {
                    var id = shape.TryGetProperty("id", out var i) ? i.GetString() : null;
                    var kind = shape.TryGetProperty("kind", out var k) ? k.GetString() : null;

                    if (id is null)
                    {
                        yield return new(CheckSeverity.Error, "shape/no-id",
                            $"view '{view.Name}' has a shape with no id; it cannot be selected, styled or removed");
                        continue;
                    }
                    if (kind is null || !ShapeKinds.Contains(kind))
                    {
                        yield return new(CheckSeverity.Error, "shape/unknown-kind",
                            $"shape '{id}' has kind '{kind ?? "(none)"}', which the canvas does not draw (known: {string.Join(", ", ShapeKinds.Order())})", id);
                        continue;
                    }
                    if (kind == "label" && string.IsNullOrWhiteSpace(shape.TryGetProperty("text", out var txt) ? txt.GetString() : null))
                        yield return new(CheckSeverity.Warning, "shape/empty-label",
                            $"label '{id}' has no text, so it draws nothing", id);

                    foreach (var end in new[] { "fromAnchor", "toAnchor" })
                    {
                        if (!shape.TryGetProperty(end, out var anchor) || anchor.ValueKind != JsonValueKind.Object) continue;
                        var anchorKind = anchor.TryGetProperty("kind", out var ak) ? ak.GetString() : null;
                        var target = anchor.TryGetProperty("id", out var tid) ? tid.GetString() : null;
                        if (anchorKind is null or "free" || target is null) continue;

                        var known = anchorKind == "element" ? elementIds.Contains(target) : shapeIds.Contains(target);
                        if (!known)
                            yield return new(CheckSeverity.Error, "shape/dangling-anchor",
                                $"arrow '{id}' anchors its {end[..^6]} end to {anchorKind} '{target}', which does not exist — the arrow silently detaches to its last known coordinates", id);
                    }
                }
            }
        }
    }

    /// <summary>
    /// Notes about what *kind* of document this is, per ADR-0018.
    ///
    /// Both are informational on purpose. `Concept` exists so an argument does not have to pretend
    /// to be an architecture; turning its presence into a warning would put the pretence back.
    /// </summary>
    private static IEnumerable<CheckFinding> RegisterFindings(ArchModel model)
    {
        var concepts = model.Elements.Count(e => e.Kind == ArchElementKind.Concept);
        if (concepts == 0) yield break;

        if (concepts > model.Elements.Count / 2)
            yield return new(CheckSeverity.Info, "model/is-a-figure",
                $"{concepts} of {model.Elements.Count} elements are Concepts — this is a figure rather than an architecture, which is a fine thing to be");
    }

    private static IEnumerable<CheckFinding> DuplicateIds(ArchModel model)
    {
        foreach (var group in model.Elements.GroupBy(e => e.Id, StringComparer.Ordinal).Where(g => g.Count() > 1))
            yield return new(CheckSeverity.Error, "model/duplicate-id",
                $"id '{group.Key}' is declared {group.Count()} times; whichever wins is arbitrary", group.Key);
    }

    private static IEnumerable<CheckFinding> DanglingLinkEndpoints(ArchModel model, HashSet<string> ids)
    {
        foreach (var link in model.Links)
        {
            if (!ids.Contains(link.FromId))
                yield return new(CheckSeverity.Error, "link/dangling-endpoint",
                    $"link '{link.Id}' starts at '{link.FromId}', which is not an element — the edge will not render", link.Id);
            if (!ids.Contains(link.ToId))
                yield return new(CheckSeverity.Error, "link/dangling-endpoint",
                    $"link '{link.Id}' ends at '{link.ToId}', which is not an element — the edge will not render", link.Id);
        }
    }

    /// <summary>`contextId`, `systemId` and `aboutId` are string references the compiler never sees.</summary>
    private static IEnumerable<CheckFinding> DanglingAttributeReferences(ArchModel model, HashSet<string> ids)
    {
        foreach (var e in model.Elements)
        {
            foreach (var attr in new[] { "contextId", "systemId", "aboutId" })
            {
                if (!e.Attributes.TryGetValue(attr, out var target) || string.IsNullOrEmpty(target)) continue;
                if (!ids.Contains(target))
                    yield return new(CheckSeverity.Error, "element/dangling-reference",
                        $"'{e.Id}' has {attr} '{target}', which is not an element", e.Id);
            }
        }
    }

    private static IEnumerable<CheckFinding> ViewFindings(IReadOnlyList<ArchView> views, ArchModel model, HashSet<string> ids)
    {
        // One pass over the model, not one per view member. A linear scan inside the loop makes this
        // quadratic in a workspace of any size, and this runs on every save in a build.
        var kindById = model.Elements
            .GroupBy(e => e.Id, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().Kind, StringComparer.Ordinal);

        foreach (var view in views)
        {
            var members = view.ElementIds.Where(ids.Contains).ToList();

            foreach (var missing in view.ElementIds.Where(id => !ids.Contains(id)))
                yield return new(CheckSeverity.Error, "view/dangling-member",
                    $"view '{view.Id}' lists '{missing}', which is not an element", missing);

            if (members.Count == 0)
                yield return new(CheckSeverity.Error, "view/empty",
                    $"view '{view.Id}' resolves to no elements — a render of it has nothing to draw");
            else if (members.Count > BusyViewThreshold)
                yield return new(CheckSeverity.Warning, "view/busy",
                    $"view '{view.Id}' has {members.Count} elements; past {BusyViewThreshold} a diagram has usually stopped answering one question");

            // A view holding both Concepts and structural kinds is mixing rhetorical registers: half
            // the boxes claim something about a system and half claim nothing, and the picture reads
            // as neither an argument nor an architecture.
            var kinds = members.Select(id => kindById[id]).ToList();
            var conceptCount = kinds.Count(k => k == ArchElementKind.Concept);
            if (conceptCount > 0 && conceptCount < kinds.Count)
                yield return new(CheckSeverity.Warning, "view/mixed-register",
                    $"view '{view.Id}' mixes {conceptCount} Concept(s) with {kinds.Count - conceptCount} structural element(s); a diagram usually wants to be one or the other");

            // Links render only when *both* endpoints are in the view. A relationship that is in the
            // model and silently absent from the picture is the failure this catches: the diagram
            // looks fine and is missing an arrow the author believes is there.
            var present = members.ToHashSet(StringComparer.Ordinal);
            foreach (var link in model.Links)
            {
                if (present.Contains(link.FromId) ^ present.Contains(link.ToId))
                {
                    var absent = present.Contains(link.FromId) ? link.ToId : link.FromId;
                    yield return new(CheckSeverity.Info, "view/half-link",
                        $"view '{view.Id}' includes one end of link '{link.Id}' but not '{absent}', so that relationship will not be drawn");
                }
            }
        }
    }
}
