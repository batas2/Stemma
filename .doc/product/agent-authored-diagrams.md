# Agent-Authored Diagrams for Publication

> Capability gap analysis: what Stemma needs before an LLM agent can produce publication-grade
> diagrams from a Stemma model as reliably as it currently produces them in draw.io.
> Written **2026-08-08** against `main`. Feature records it should spawn are listed in §9.
>
> **All four phases shipped, 2026-08-08.** Status per item is marked inline below and, more
> usefully, in the feature records F-004 through F-010.
>
> **Built:** the sidecar keeps unknown sections (B-001); node titles wrap; export takes
> transparency, scale and padding; a published JSON Schema and a protocol reference with three
> worked examples; `stemma render` and `stemma validate`; a publication profile and named palettes;
> layout as a declarative constraint, authorable from the canvas or as text, with nudges as offsets;
> a render manifest and `--check`; the `Concept` element kind (ADR-0018) and the `Relation` link
> kind (ADR-0019); free-form shapes persisted, documented and validated; a draw.io export that
> honours the view and the layout; and true vector SVG out of the publication profile.
>
> **Still open, and small:** `STEMMA.md` in the workspace scaffold (F-007 AC6); an embedded or
> outlined font in the SVG, without which it re-wraps on a machine that lacks Inter (F-009 AC5); a
> keyboard path to the constraint panel; and a figure-shaped sample, since Aurora Rail is an
> architecture and deliberately exercises neither new kind.

## 0. Why this document exists

Stemma's maintainer publishes a weekly essay at [bfrackowiak.pl](https://bfrackowiak.pl/), and every
essay whose argument has structure carries two or three diagrams. Those diagrams are currently drawn
by an LLM agent writing `.drawio` XML by hand. One post — *We Deleted the Wrong Half of Agile* —
was drawn in Stemma instead, as a deliberate experiment. It worked, but it cost a 190-line Playwright
script that drags nodes around with synthetic mouse gestures, and the resulting pictures are visibly
screenshots of an application rather than diagrams.

That experiment is the best evidence we have about what Stemma is missing, because it is the only
place where a real, external, recurring workload has been pushed through the tool end to end. This
document reads it as a bug report against the product.

The stakes are larger than one blog. The same missing capability — *turn a model plus a view into a
correct image without a human touching a mouse* — is what View Books, the Architecture Report
(F-001), and any future sharing layer all need. Publication rendering is not a blog feature; it is
the projection half of "the diagram *is* the code", and it was unbuilt when this was written.

### The new persona

`users-and-personas.md` names four personas, all of whom consume views inside the app. This workload
introduces a fifth, and it is not a human:

> **The Essayist's Agent ("Ada").** An LLM agent with filesystem and shell access, working in a
> repository that is not the Stemma repository. It is asked: *"the argument in this section is that
> X and Y diverge — draw it."* It has never opened the Stemma UI, cannot click, cannot see the
> canvas, and gets exactly one chance to produce a file that the essay will reference. It succeeds
> when the PNG on disk is correct, on-palette, and reproducible; it fails when it needs a human to
> drag anything.

Ada is not a niche. Ada is what "AI agents edit the same model" (`vision.md`) looks like when the
output is a picture rather than a diff — and when this was written Stemma served the diff half well
and the picture half not at all.

### The workload, concretely

Two to three diagrams per post, roughly weekly, in two distinct classes:

| Class | Example | What it needs |
|---|---|---|
| **Argument diagram** | *the queue moved*, *two first steps*, *who do you ask* | Free vocabulary, prose-length labels, swimlane annotations, an "absent" box, tight control of position. Seven boxes maximum. |
| **Architecture diagram** | a real C4 container view, a dependency shape, a strangler migration | Exactly what the Stemma DSL already models — typed elements, lifecycle, links with payloads. |

Stemma should be *dramatically* better than draw.io at the second class, because the model is real
and the picture cannot drift. When this was written it was worse at both. The second class is where the win is,
and it is also, awkwardly, the class where the tooling gap bites hardest, because a strict
architecture diagram has more elements and therefore more layout to get right.

### The contract the output must satisfy

Non-negotiable, set by the blog's own house style (`bfrackowiak.pl/docs/POST-PROMPT.md`), not by
Stemma:

- Editable source committed to `drafts/diagrams/<slug>/`; PNG served from `assets/img/posts/<slug>/`.
- **Transparent background.** The site is `#fbfbfd` in light mode and `#0f1014` in dark. An opaque
  export is a glaring slab for half the readers.
- Strokes and text `#767884`; the single accent `#6366E8`; **no fills**; no shadows; no gradients.
- Exported at 200% zoom for retina, 8px border.
- **Never encode meaning in colour alone** — position, label, or line style must carry it too.
- Seven boxes maximum, one question per diagram.

Every one of those bullets was violated by Stemma's PNG export when this was written. Phase 0 closed
the two mechanical ones — the export can now be transparent and can be scaled. The rest are about
*what the canvas draws*, not how it is captured, and they stand: the ink, the chrome, the shadows and
the colour-coded status badges are all still app UI. That is not a criticism of the canvas — the
canvas is styled for an application, correctly — it is the observation that **"render for the screen"
and "render for print" are different jobs and Stemma still only has the first.**

---

## 1. The benchmark: what draw.io actually gives an agent

It is worth being precise about *why* an agent is good at draw.io, because the reasons are the
requirements list. Here is a real published diagram's entire source
(`the-bottleneck-moved/who-do-you-ask.drawio`, abbreviated):

```xml
<mxCell id="c5" value="nobody to ask"
        style="rounded=1;arcSize=14;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#767884;
               fontColor=#767884;fontSize=13;fontFamily=Inter;strokeWidth=1.6;dashed=1;dashPattern=5 4;"
        vertex="1" parent="1">
  <mxGeometry x="430" y="136" width="190" height="58" as="geometry"/>
</mxCell>
<mxCell id="c11" value="human"
        style="text;html=1;strokeColor=none;fillColor=none;fontColor=#767884;fontStyle=1;"
        vertex="1" parent="1">
  <mxGeometry x="20" y="57" width="60" height="24" as="geometry"/>
</mxCell>
```

Eight properties matter. Stemma had roughly two of them when this was written and now has six —
the two outstanding are free annotation ink (5) and a human reopening the result to edit one arrow
(8), which is what F-009 is for:

1. **One declarative text file holds everything** — semantics, geometry, and style. Nothing lives in
   a browser, a database, or a session.
2. **The agent authors absolute geometry.** There is no layout engine to negotiate with. An LLM is
   genuinely good at "four boxes, 260px apart, two rows" and genuinely bad at predicting what a
   force-directed layout will do.
3. **Every visual property is addressable by name** in a style string it can write from memory.
4. **The vocabulary is free.** A box is a box. Nothing forces "nobody to ask" to be a `Module`.
5. **Text-only shapes exist** for annotation — the `human` / `agent` row labels above are not
   entities, they are ink.
6. **Headless export is a first-class, deterministic command** — file in, PNG out, with transparency
   and scale as flags.
7. **Zero ambient state.** No server, no "currently open workspace", no localStorage, no gestures.
   Two diagrams can be rendered in parallel by two agents.
8. **A human can open the result and edit one arrow** two years later.

And the cost, which is exactly Stemma's founding argument: that XML is a *drawing*. It knows nothing
about the system. It cannot be validated, cannot be re-projected for another audience, and drifts
the moment the architecture changes. For the argument diagrams that hardly matters. For the
architecture diagrams it matters enormously — which is why closing this gap is worth doing rather
than shrugging and staying on draw.io.

---

## 2. What Stemma already has

Being fair about the inventory, because most of the substance is present and the gaps are narrower
than they look.

| | draw.io | Stemma today |
|---|---|---|
| Typed architecture vocabulary | ✗ | ✓ 11 element kinds, 2 link kinds, lifecycle + ownership tags |
| Model validation | ✗ | ✓ `RuleEngine`, violations surfaced on canvas |
| Views as code, re-projectable | ✗ | ✓ `Views/<Name>.cs`, three base lenses |
| Node/edge appearance vocabulary | ✓ | ✓ and arguably richer (`nodeStyles.ts`, `edgeStyles.ts`: fills, borders, radius, shadow, accent bar, animation, per-edge routing and both-end markers) |
| Free-form annotation shapes | ✓ | ✓ built (`shapes.ts`: rect/ellipse/triangle/label/arrow/image); the reload loss in G5 was fixed in Phase 0 |
| Auto-layout | ~ (basic) | ✓ four tunable algorithms (`autoLayout.ts`: hierarchical, force, focused, byType) |
| **Author the whole diagram as text** | ✓ | ✗ |
| **Headless render to image** | ✓ | ✗ |
| **Publication-grade export** (transparent, scaled, cropped) | ✓ | ✗ |
| **Documented file format** | ✓ (mxGraph is public) | ✗ sidecar schema is explicitly undocumented |

The pattern is clear. Stemma's *modeling* and *presentation vocabularies* are ahead of draw.io. Its
**authoring surface for that vocabulary is a mouse**, and its **output surface is a browser
download**. Both gaps are addressable without touching the engine or the fidelity contract.

---

## 3. The gap, read off the one real attempt

`bfrackowiak.pl/drafts/diagrams/we-deleted-the-wrong-half-of-agile/capture.mjs` is 190 lines that
exist entirely to work around missing product capability. Each workaround names a gap.

### G1 — There is no headless path from model to image

The script must: start `./run.sh --prod`, launch a real Chrome, navigate to `localhost:5050`,
`POST /api/workspace/open`, reload the page, wait 2500ms, click the **Views** button, click the view
by its display text, click **Fit View**, wait 1200ms, then screenshot.

Every step is a UI affordance being driven as an API. There is no `stemma render` and no route that
takes a workspace and a view and produces a picture. `ExportMenu.tsx` dispatches a `window`
CustomEvent (`stemma:export-image`) that `ArchCanvas.tsx:794` listens for; the only trigger is a
click in a dropdown.

**Consequence:** the render is timing-dependent, and the script compensates with eight hard-coded
`waitForTimeout` calls. There is no readiness signal anywhere in the client.

### G2 — Layout cannot be authored, only performed

This is the single biggest gap, and the script's own comment says so:

> *"Layout is done by dragging, which is the only thing that sticks. Three cheaper routes were tried
> first and all lost to the same rule... neither `Reviewability/stemma.layout.json` (which the server
> does serve back) nor a pre-seeded localStorage entry survives contact with the first render. Only a
> real pointer drag registers."*

So the script implements a grid layout engine in Playwright: it measures every node's rendered box,
computes column widths and row heights, then performs **three full passes of synthetic mouse drags**,
re-reading an anchor node before each one because React Flow auto-pans the canvas mid-gesture and
invalidates absolute screen targets.

Two structural causes sit under this:

- **The layout mode is not in the sidecar.** `viewLayouts` — whether a view is `custom`, `force`,
  `hierarchical`, or `byType` — is persisted to **localStorage only** (`store.ts:42-49`, `:81`). It
  never reaches `stemma.layout.json`. A workspace cloned from Git therefore does not carry the
  information that decides whether saved coordinates are honoured or immediately overwritten by an
  auto-layout. *The presentation sidecar is described as the committed presentation layer, and on
  this one field it isn't.*
- **`primeLayoutSidecar` is fire-and-forget.** `App.tsx:71` and `:89` call it without awaiting;
  `loadLayout` (`layout.ts:109`) falls through to localStorage when the cache is not yet primed,
  which in a fresh Playwright context is empty. The node-build effect can therefore run against
  default grid positions. There is a re-read on the `primed` event, but the ordering is a race, not
  a contract.

**Consequence:** the committed layout in `Reviewability/stemma.layout.json` contains coordinates like
`-1640.7398601398602` — the residue of mouse drags, not something any agent or human authored. It is
output, not input.

### G3 — The export is not publication-grade

`ArchCanvas.tsx:819`:

```ts
const opts = { backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
               pixelRatio: 2, filter };
```

- **The background is always opaque** — the body colour, by construction. **[Fixed in Phase 0.]** Transparency, which the
  blog contract requires, is not expressible. This is why the post ships *light/dark PNG pairs* and
  a `<picture>` element: two files, two renders, twice the surface for drift, purely to work around
  one hard-coded value.
- `pixelRatio`, padding (`0.12`, line 811), and max zoom (`2.5`) are constants.
- The file is delivered by `a.download = 'stemma.png'` (line 824) — no path, no name, no directory.
  The script screenshots the viewport instead and computes the crop itself, in DOM coordinates, with
  a hand-tuned 26px pad.
- Chrome suppression is a `filter` callback for the React Flow panels; the script *additionally*
  injects CSS to hide minimap, controls, attribution and toasts, and clicks bare canvas to drop the
  selection ring — "never with Escape: Escape also closes the active custom view, and the screenshot
  then quietly contains the whole model."
- **The SVG export is not vector.** `html-to-image`'s `toSvg` wraps serialised HTML in a
  `<foreignObject>`. It renders in a browser and essentially nowhere else — not in Inkscape, not in
  most static pipelines. So the one output that would survive resizing for a talk slide or a
  LinkedIn carousel does not actually work outside Chrome.

### G4 — There is no export theme

The canvas renders app UI: type chips (`BOUNDED CONTEXT`, `CAPABILITY`), kind icons, drop shadows, a
dotted background grid, coloured status badges. All correct in the product. All wrong in an essay.

Look at what shipped in `two-jobs-dark.png`: ten cards each repeating the line *"in Make the artifact
answer for itself"* (the `contextId` field is in `DEFAULT_VISIBLE_FIELDS`, `nodeStyles.ts:28`), status
carried by **green / amber badges** — colour-alone meaning, which the house style forbids — and four
distinct hues against a two-colour palette. Compare `who-do-you-ask.png` from draw.io: outline boxes,
one grey, one accent, dashed for the broken path, transparent ground.

The difference is not craft. It is that draw.io was told what ink to use and Stemma was not asked.

### G5 — The presentation sidecar is undocumented *and* lossy

**Undocumented, deliberately.** `LayoutSidecar.cs:14-16`: the rich sections are stored as pass-through
`JsonElement` because *"the web client owns their schema, the engine only persists them verbatim."*
Reasonable for shipping velocity; fatal for Ada, who cannot author `nodeStyles`, `edgeStyles`,
`annotations` or `customProps` without reverse-engineering four TypeScript files.

**Lossy, apparently accidentally.** The server's `ViewLayout` (`LayoutSidecar.cs:37-41`) declares only
`nodes` and `edges`; `EdgeWaypoints` (`:49-53`) declares only `waypoints` and `labelOffset`. There is
**no `[JsonExtensionData]` anywhere in the solution** (verified by grep). But the client writes:

- `views.<key>.shapes[]` — every free-form shape (`layout.ts:52-63`)
- `views.<key>.edges.<id>.handles` — draw.io-style edge docking (`layout.ts:214-235`)

`PUT /api/workspace/layout` (`Program.cs:244`) binds the body into `LayoutSidecar` and calls
`.Write()`. System.Text.Json drops unknown members on bind. **Shapes and edge dock handles are
therefore silently discarded before they reach disk** — and no sample workspace on disk contains a
single `shapes`, `handles`, `waypoints` or `labelOffset` key, despite all four features being shipped
and listed under "Now" in the roadmap.

This should be reproduced and filed as a bug regardless of anything else in this document. It means
free-form annotation — the capability the argument diagrams need most — currently survives only until
reload.

### G6 — The vocabulary does not fit argument diagrams, and labels are truncated

To draw an essay's argument, the experiment declared *"Contracts at the seams"* as a `Module`,
*"What the repository can answer"* as a `BoundedContext`, and XP practices as `Capability`. The model
compiles, validates, and means nothing. Worse, the semantic types then *drive the rendering* — hence
the `BOUNDED CONTEXT` chips and the repeated context line in the picture.

And a hard constraint the author had to design around, recorded in the workspace source **[fixed in Phase 0 — titles now wrap]**: *"Kept
short: the node clips its title around thirty characters."* `ArchNodeView.tsx:361` applies Tailwind's
`truncate` — `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. Single line, no wrap.
draw.io's equivalent is `whiteSpace=wrap`, one property.

For an argument diagram the box label *is* a sentence. This alone disqualifies the current node from
publication use.

### G7 — The workspace is a process-global singleton

`EngineHost` holds one engine; `POST /api/workspace/open` swaps it. Rendering a diagram therefore
mutates the state of whatever the maintainer had open, and two renders cannot run concurrently. The
script even opens the workspace *four times* — once per theme × view — because that is the only way
to reset.

### G8 — Nothing verifies the output

The script ends with a hand-rolled guard:

> *"A stray click or key can drop the active custom view, and the shot then silently contains the
> entire model. Count the nodes and refuse to pretend that is the diagram."*

An agent that cannot see its own output needs the tool to assert the invariant. Nothing in Stemma
does. There is no "this image contains exactly the 8 elements of `view_destinations`" contract.

### G9 — The draw.io and Mermaid exporters are decorative

The obvious escape hatch — model in Stemma, export to draw.io, render with draw.io's mature CLI —
does not work today:

- `GET /export/drawio` (`Program.cs:143`) calls `DrawioExporter.Export(arch)` with **no positions and
  no view filter**. It emits the entire model on a 180×100 grid, labels every box `Module: Name`, and
  hard-codes draw.io's default pastel palette (`#dae8fc`, `#fff2cc`, …) — the precise opposite of the
  required style. The `positions` parameter exists in the signature and no caller ever supplies it.
- `MermaidExporter` handles three fixed lenses, drops every element kind outside them (questions,
  risks, assumptions, capabilities never appear in `moduleMap`), and carries no styling. The HTTP
  endpoint exposes only two of the three.

Both are one afternoon each from being genuinely useful. Neither is useful now.

---

## 4. Proposal

Four tracks. They map onto the three capabilities you named — *protocol document*, *easy image
export*, *easy layouting* — plus one you did not, which the evidence says is equally load-bearing:
**a publication render profile**. Ordering and cost are in §6.

### Track A — The protocol: make the format authorable from text

The goal is that Ada, reading one document, can write a correct workspace on the first attempt.

- **A1 · Publish the sidecar schema. ✅ Shipped.** Generate `schema/stemma.layout.schema.json` from the
  TypeScript types (`nodeStyles.ts`, `edgeStyles.ts`, `shapes.ts`, `layout.ts`) and check it in,
  versioned alongside `LayoutSidecar.Version`. Add `$schema` to written sidecars so editors validate
  live. This reverses the "client owns the schema" position — deliberately, because the moment a
  non-browser writer exists, an undocumented format is a broken contract. Pair it with
  `[JsonExtensionData]` on the server types so unknown sections round-trip instead of vanishing
  (fixes G5's loss independently of documenting it).
- **A2 · `.doc/protocol/authoring-a-diagram.md` — not built.** — one agent-facing reference covering the complete
  chain: `Architecture.cs` vocabulary → `Views/<Name>.cs` → `stemma.layout.json` → render command.
  Distinct in audience from `architecture/domain-model.md`, which explains the DSL to people building
  Stemma. This one explains it to a writer who will never open the app, and it must carry **three
  complete, copy-pasteable worked examples**: an argument diagram, a C4 container view, and a
  dependency view. Examples beat prose for this reader by a wide margin.
- **A3 · `STEMMA.md` in the workspace scaffold — not built.** `WorkspaceScaffold.cs` already generates new
  workspaces; have it drop a short agent-facing brief at the root — vocabulary, id conventions,
  "run `stemma render` to see it", the seven-box rule. The same trick `CLAUDE.md` plays for this
  repository, applied to every workspace Stemma creates.
- **A4 · `stemma validate --json`. ✅ Shipped.** Expose the existing `RuleEngine` plus the id-integrity check
  that currently lives only in `AuroraRailSampleTests`, as machine-readable output: dangling ids,
  view members that don't exist, links whose endpoints aren't both in the view (they silently don't
  render — `domain-model.md:66`), and a soft warning above seven nodes. An agent can act on a JSON
  error; it cannot act on a missing node it never sees.

### Track B — Headless render: file in, image out

The centrepiece. Everything else is worth less until this exists.

- **B1 · `stemma render` CLI. ✅ Shipped.**

  ```
  stemma render <workspace> --view view_destinations \
      --out assets/img/posts/<slug>/where-the-question-goes.png \
      --profile publication --transparent --scale 2 --pad 24 --format png,svg
  ```

  **Implementation shape: a render *mode* of the existing canvas, not a second renderer.** Add a
  `/render?workspace=…&view=…&profile=…` route to the client that boots straight into a bare canvas
  with no chrome, and have the CLI drive it with Playwright — already a dev dependency, already
  configured (`playwright.config.ts`), already used for visual regression. A second renderer is a
  second truth, and a diagram that renders differently in the app than in the post is the drift
  Stemma exists to abolish — see §8 · Q2, where this is settled for the vector case too.

  The CLI is `src/Stemma.Cli` (§8 · Q1), driving the page through `Microsoft.Playwright`. Not
  `Stemma.Engine` — rendering is a web concern and engine purity is inviolable.

- **B2 · A deterministic readiness signal. ✅ Shipped.** The render route sets
  `document.documentElement.dataset.stemmaRender = 'ready'` once the model is loaded, the sidecar is
  primed (**awaited**, not raced), layout is applied, fonts are loaded, and React Flow reports all
  nodes measured. This deletes eight `waitForTimeout` calls and is the difference between a script
  that works and a script that works *today*.

- **B3 · Publication export options in the shared path. ✅ Shipped.** Promote the constants at
  `ArchCanvas.tsx:811-819` to parameters: `backgroundColor: 'transparent' | <token>`, `pixelRatio`,
  `padding`, `maxZoom`, and an exact node-bounds crop. Surface the same options in the UI export
  dialog so what the CLI does is what the button does.

- **B4 · True vector output, from the same renderer** (later). Have the `publication` profile emit
  SVG primitives — `<rect>`, `<text>` with pre-computed `<tspan>` lines — instead of styled `<div>`s,
  and serialise that live subtree rather than rasterising it. Unlocks resizing for slides and
  carousels and diffs meaningfully in Git, **without** a second implementation of node rendering or
  of line breaking. Build it after B1 ships and the publication styling has settled. The rejected
  alternative — a standalone server-side SVG renderer — and the reasoning are in §8 · Q2.

- **B5 · A render manifest. ✅ Shipped.** Each render emits a sibling JSON: view id, element ids included,
  bounding box, and a hash of `(model, view, layout, profile)`. The blog build can then fail loudly
  when a committed PNG no longer matches its source. This is the whole "diagram that cannot lie"
  thesis extended past the app window — and it is something draw.io structurally cannot offer.

### Track C — Layout as data, not as gestures

- **C1 · Make the sidecar sufficient. ✅ Shipped.** Move `viewLayouts` (layout mode) out of localStorage into
  `stemma.layout.json` (`views.<key>.layoutMode`), and let saved positions win unconditionally when
  the mode is `custom`. Fix the shapes/handles drop (G5). After this, a fresh clone renders
  byte-identically to the author's machine — which is not true today.

- **C2 · A declarative layout DSL. ✅ Shipped.** The highest-leverage idea in this document. An LLM is poor at
  pixel coordinates and excellent at intent, so let it express intent and have Stemma solve for
  pixels:

  ```jsonc
  "views": {
    "custom:view_destinations": {
      "layout": {
        "kind": "grid",
        "columns": [["q_blast", "mod_contracts"], ["q_why", "mod_decision"]],
        "gap": [56, 30], "align": "center"
      }
    }
  }
  ```

  Add `row`, `column`, `stack`, `pin`, and `align`. **This is precisely what `capture.mjs`
  hand-rolled** — a column grid with per-column widths and per-row heights — implemented once, in the
  product, without the mouse. It is also the answer to "seven boxes maximum": at that size a
  constraint grid is not merely adequate, it is better than force-directed, because the author knows
  what the arrangement *means*.

  The constraint **stays live** and a manual drag records an offset against it rather than replacing
  it; solved coordinates are not committed. §8 · Q6 works through why, and corrects an earlier
  version of this bullet that had the constraint dissolve on first drag.

- **C3 · Auto-layout available headlessly. ◑ Partly** — the size estimator (C4) exists; the algorithms are still client-only. `autoLayout.ts` is already pure functions over
  `(elements, links, sizes)` — good design, wrong reachability. Expose the four algorithms via
  `stemma render --layout hierarchical` and as a Node-callable entry point. For strict architecture
  diagrams with twenty elements this is the fast path; C2 is for the seven-box arguments.

- **C4 · DOM-free size estimation. ✅ Shipped.** C3 needs node dimensions before a DOM exists. Add a text-metrics
  estimator (font, size, wrap width, visible field count → w×h) shared by the layout code and the
  renderer, so `stemma render --layout …` produces the same arrangement the canvas would.

### Track D — A publication profile

- **D1 · Wrap node labels. ✅ Shipped.** Replace `truncate` at `ArchNodeView.tsx:361` with wrapping plus an
  explicit `width` in `nodeStyles`. One line of Tailwind; removes a hard constraint that currently
  distorts the writing itself.
- **D2 · Make free-form shapes real. ◑ Partly** — B-001 fixed the persistence and the schema documents them; there is still no authoring surface. Once G5's persistence is fixed and A1 documents the schema,
  `shapes.ts` already covers the *annotation* half of what argument diagrams need — labels for
  swimlanes, dashed frames, callouts. Keep those presentation-side: they are ink, not model, and
  putting them in `Architecture.cs` would violate "code is the database" for something that carries
  no meaning at all.
- **D5 · A `Concept` element kind. ✅ Shipped (ADR-0018).** (§8 · Q3). The other half: a box that participates in the
  argument's graph — arrows connect it, a view includes it, the layout DSL positions it — while
  asserting nothing about a system. This is the one model change in the whole proposal, it is the fix
  for G6's semantic abuse, and it carries the full operation procedure (≥3 round-trip fixtures before
  implementation). The `Concept`-versus-ink boundary is drawn in §8 · Q3.
- **D3 · A `publication` render profile. ✅ Shipped.** Outline-only boxes, no kind chip, no icon, no shadow, no
  background grid, no status badge, `visibleFields: ['name']` by default, hairline edges. The delta
  between the two PNGs in §3 is almost entirely this one setting.
- **D4 · Named export palettes.** A palette is a **render argument**, not workspace state:
  `--palette dual-theme` resolves a built-in, `--palette ./blog.palette.json` a file. Stemma ships a
  neutral `dual-theme` default (one ink legible on both a light and a dark page — the general
  constraint behind the blog's `#767884`), plus `print` and `slide`. No customer's brand ships in the
  product; the sidecar may name a default so the app previews correctly. Include an accessibility
  check in `validate`: warn on a palette that encodes state in hue without a second channel — the
  house rule Stemma's own status badges currently break. Reasoning in §8 · Q4.

---

## 5. Where this lands

| Capability | draw.io | Stemma today | Stemma after A–D |
|---|---|---|---|
| Author the whole diagram as text | ✓ | ✗ | ✓ (DSL + sidecar + schema) |
| Absolute geometry authorable | ✓ | ✗ (drag only) | ✓ + declarative constraints (better) |
| Prose-length labels | ✓ | ✓ *(shipped Phase 0)* | ✓ |
| Free annotation ink | ✓ | ~ (not persisted) | ✓ |
| A box that claims nothing | ✓ | ✗ (must be a `Module`) | ✓ (`Concept`, D5) |
| Headless render | ✓ | ✗ | ✓ |
| Transparent / scaled / cropped export | ✓ | ~ transparent + scale shipped; crop still viewport-based | ✓ |
| True vector output | ✓ | ✗ (foreignObject) | ✓ (B4) |
| Parallel / isolated renders | ✓ | ✗ (singleton) | ✓ (G7) |
| Documented file format | ✓ | ✓ *(schema shipped Phase 0)* | ✓ |
| **Typed architecture semantics** | ✗ | ✓ | ✓ |
| **Validation of the picture** | ✗ | ✓ | ✓ + render manifest |
| **Re-projection into another view** | ✗ | ✓ | ✓ |
| **Cannot drift from the model** | ✗ | ✓ | ✓ **and provable in the published PNG** |

The bottom four rows are the reason to do this rather than stay on draw.io. They are also,
currently, entirely theoretical for anyone outside the app window.

### The acceptance test

One benchmark, chosen because the target already exists and was drawn by the competitor:

> **Reproduce `assets/img/posts/the-bottleneck-moved/who-do-you-ask.png` from a Stemma workspace,
> with a single command, no browser, no mouse — transparent, on-palette, byte-stable across two
> runs on two machines.**

It requires a free-vocabulary box with a wrapped prose label (D1), a dashed "absent" box (D2), two
swimlane text labels (D2), an explicit two-row grid (C2), the blog palette (D4), the publication
profile (D3), and headless transparent export (B1–B3). If that command works, the whole programme
works. The obvious second benchmark is the strict case: a C4 container view of Aurora Rail's booking
path, rendered with `--layout hierarchical`, correct without a single manual position.

---

## 6. Sequencing

Cost estimates are rough and assume the maintainer working alone.

**Phase 0 — stop the bleeding. ✅ Shipped 2026-08-08.** No new architecture; fixes and one-liners
that make the existing route survivable.
`[G5 fix: JsonExtensionData + shapes/handles round-trip]` · `[D1: wrap labels]` · `[B3: transparent +
scale + pad as export options]` · `[A1: publish the sidecar schema]`.

Two deliberate deviations from the plan as written, both erring towards not surprising existing
users:

- **B3 did not flip the default.** Export stays opaque unless asked otherwise, because changing what
  the toolbar button produces would silently alter every existing user's output. Transparency and
  scale are a remembered preference in the export menu instead, and the publication profile (D3)
  will opt in explicitly. The resolution rules live in `lib/exportImage.ts` so the headless renderer
  reaches the same code path the button does — a second path would be a second truth.
- **A1's schema is hand-maintained, not generated.** A generator would be a build step nobody runs.
  Two tests guard the drift that matters instead: every section the engine models must appear in the
  schema, and the version and `$id` must match the engine's constants.

It also turned up one thing the analysis had missed: **the top-level `annotations` section is dead.**
It is declared, read, and preserved, but nothing has written it since free-form shapes moved to
`views.<key>.shapes`. The schema records it as deprecated rather than pretending it is live.

*`capture.mjs` can now drop its light/dark pair — one transparent PNG serves both themes — and the
node titles it had to keep under thirty characters no longer clip.*

**Phase 1 — the render pipeline. ✅ Shipped 2026-08-08.** The phase that changes the workflow.
`[B1: stemma render + /render route]` · `[B2: readiness signal]` · `[D3: publication profile]` ·
`[C1: layoutMode into the sidecar]` · `[G7: process-per-render isolation, §8 · Q5]`.
*After this, `capture.mjs` is deleted and the acceptance test's first half passes.*

**Phase 2 — authorability. ◑ Partly shipped 2026-08-08** — C2, C3/C4 and D5 are done; A2 and D2 are not.
`[C2: layout DSL]` · `[C3+C4: headless auto-layout with size estimation]` · `[A2: the protocol doc
with three worked examples]` · `[D2: shapes documented and authorable]` · `[D4: named palettes]` ·
`[D5: the Concept kind]`.
*After this, Ada writes a diagram from a blank workspace without ever seeing it — and an argument
diagram no longer has to claim it is a bounded context.*

D5 is the only item in the programme that touches the engine and therefore the fidelity suite. It can
be deferred a phase without blocking anything else; everything before it is presentation-side.

**Phase 3 — proving it. ◑ Partly shipped 2026-08-08** — B5 and A4 are done; A3, B4 and G9 are not.
`[B5: render manifest + staleness check]` · `[A4: validate --json]` · `[A3: STEMMA.md scaffold]` ·
`[B4: SVG-emitting publication profile]` · `[G9: fix the draw.io exporter to honour positions, view
filter, and palette]`.

Phase 0 alone is worth doing this week; it fixes a data-loss defect and removes a constraint that is
currently shaping the maintainer's prose.

---

## 7. What this does not change

Checked against `CLAUDE.md`'s inviolable rules, because a proposal that violates them is dead on
arrival:

- **No new data store.** Everything proposed lands in `Architecture.cs` (model) or
  `stemma.layout.json` (presentation). The layout DSL, palettes, layout mode, and shapes are all
  presentation. The one thing that *moves* — `viewLayouts` — moves *out of* localStorage *into* the
  sidecar, i.e. one fewer store, not one more.
- **No engine impurity.** `Stemma.Engine` gains nothing web-shaped. The renderer is a client route;
  the CLI (`src/Stemma.Cli`) is a host concern and depends on the engine, not the reverse.
- **One item touches C# source, and it follows the procedure.** Everything in Tracks A, B and C is
  presentation-side and rewrites nothing. **D5 (the `Concept` kind, §8 · Q3) is the exception:** it
  extends `ArchElementKind`, so `AddElementOp`/`RenameElementOp`/`RemoveElementOp` must emit and
  rewrite `new Concept(...)` declarations. That is a normal engine change under a well-understood
  contract — spec first, then ≥3 round-trip fixtures (minimal / realistic / pathological), then
  `DocumentEditor`, then the fidelity suite — and it is deliberately sequenced last (Phase 2) so no
  other work waits on it.
- **No `NormalizeWhitespace`, no string-concatenated files, no method bodies, no generated files.**
  Untouched, including by D5.

The one genuine reversal is A1: the sidecar's rich sections stop being client-private. That is a
deliberate change of position, and it is the correct one the moment a second writer exists.

---

## 8. Decisions

These began as the six open questions this analysis could not settle from the evidence alone. All
six are now decided; the summary is below and the reasoning follows in a subsection each. **Two of
them supersede text written earlier in this document** — Q4 replaces D4's original "palettes section
in the sidecar", and Q6 replaces C2's original "cache solved positions into `nodes`". Where a
decision contradicts an earlier draft, the decision wins and the earlier bullet has been corrected in
place.

1. **Where does the CLI live?** — **Resolved: a new `src/Stemma.Cli` project.** The alternatives were
   a `--render` mode on `Stemma.Web` and a Node script beside the client (where Playwright already
   lives). One binary wins over one fewer dependency: `Stemma.Cli` takes `Microsoft.Playwright` and
   drives the render route, keeping `Stemma.Engine` free of both browser and web concerns.
2. **Is a second renderer ever acceptable?** — **Resolved: no.** The reasoning and the four options
   considered are below, under *Q2 — Resolved*.
3. **Does the argument-diagram case deserve model vocabulary at all?** — **Resolved: yes, exactly one
   kind.** The reasoning and the four options considered are below, under *Q3 — Resolved*.
4. **Should the blog's palette ship with Stemma?** — **Resolved: the technique ships, the brand does
   not.** See *Q4 — Resolved*.
5. **Isolation model for concurrent renders** — **Resolved: one short-lived process per render.**
   See *Q5 — Resolved*.
6. **Does the layout DSL replace or complement stored coordinates?** — **Resolved: neither, as
   originally framed.** Deterministic constraints stay live and are adjusted by offsets; heuristic
   layouts stay one-shot generators. This supersedes the recommendation first written into C2. See
   *Q6 — Resolved*.

### Q2 — Resolved: the vector exporter must not be a second renderer

**Decision: Option 2.** The `publication` profile emits SVG primitives from the existing component
tree, in the browser. No standalone non-browser renderer is built.

#### What the question really was

Stemma has exactly one renderer today: the browser. A node is a React component
(`ArchNodeView.tsx`) — an HTML `<div>` styled with Tailwind; edges are SVG drawn by React Flow; PNG
export serialises that DOM through `html-to-image`. B4 as originally framed ("model + layout + styles
→ hand-written SVG, server-side") means **implementing "what a Stemma node looks like" a second
time**: rounded rect, border, title, *text wrapping*, field lines, edge routing across four modes,
markers, labels.

#### Why a second implementation is not a cosmetic risk

**Text measurement is the crux.** The browser breaks *"The rejected options, written down"* inside a
190px box using the actual Inter font file — glyph advances, kerning, its own line-breaking
algorithm. A standalone renderer must either parse the font (opentype.js, HarfBuzz/SkiaSharp) or
approximate. **If the break lands one word differently, the box gains a line (~18px) and everything
below it in a grid shifts.** That is a structurally different picture, not a slightly different one.
The same argument applies in reverse to C4: node height feeds C2's layout solver, so a measurement
disagreement changes the arrangement, not just the ink.

**Font availability is the second trap, and it survives any implementation.** An SVG carrying
`font-family: Inter` re-wraps on a machine without Inter. To be stable it must embed a subset font
(heavy) or convert text to paths (which forfeits the editability that was the point of vector).

#### The reframe that makes this tractable

Divergence only matters when two renderers are *supposed* to produce the same picture. The
`publication` profile (D3) is deliberately a **different look** from the canvas — outline boxes, no
kind chip, no shadow, no grid, no status badge. So the real question narrows to:

> Is the in-app "preview as published" the *same code* as the thing that renders the file?

If yes, there is nothing to drift. If no, the maintainer arranges a diagram against one picture and
ships another — the exact failure mode Stemma exists to abolish.

The reframe also shrinks the work: a publication renderer never needs the 30-odd properties in
`nodeStyles.ts` (gradient, glass, hatch, glow, accent bar, seven animations). It needs about five
primitives — rect, wrapped text, path, marker, label.

#### The options considered

| | Approach | True vector | Divergence risk | Cost |
|---|---|---|---|---|
| 1 | Browser only; PNG at `--scale 2–4`, no vector | ✗ | none | none |
| **2** | **`publication` profile renders node bodies as SVG primitives in the existing component tree; export serialises the live SVG** | **✓** | **none — one component tree** | **medium** |
| 3 | Standalone SVG renderer (.NET/Node) + visual-regression gate against the DOM render | ✓ | real, policed by a flaky pixel diff | high |
| 4 | Convert node HTML → SVG in `page.evaluate` at export time | ✓ | small | medium, and hackier |

Option 3 was the original B4. It fails the text-measurement test above, and its safety net — a
CI job that rasterises the SVG and pixel-diffs it against a Chrome screenshot — is precisely the
class of test that is either too loose to catch drift or too tight to stay green (antialiasing, font
hinting, subpixel positioning all differ by platform).

#### What Option 2 means concretely

- The `publication` profile's node body renders `<rect>` + `<text>` with explicitly computed
  `<tspan>` lines instead of a styled `<div>`. React Flow's edge layer is already SVG, so the whole
  canvas becomes one coherent SVG subtree.
- **Line breaking stays in the browser** — measured once via canvas `measureText` (or a DOM range)
  and emitted as `<tspan>`s. There is exactly one line-breaking implementation in the product,
  and it is the one the user sees.
- Export **serialises that subtree** rather than rasterising it through `html-to-image`. PNG is then
  produced by rasterising the same SVG (or by a Playwright screenshot of the same page), so PNG and
  SVG cannot disagree with each other or with the canvas.
- Toggling the profile on the canvas **is** the WYSIWYG preview. It costs nothing extra to build.
- It does not constrain Q1: `src/Stemma.Cli` drives the page through `Microsoft.Playwright` exactly
  as a Node script would have. The renderer's language is the browser's; the CLI's language is free.

#### What stays true regardless

**PNG remains the primary blog artifact**, because it is immune to a missing font on the reader's
machine. SVG is the secondary output — for talk slides, carousels, and edits two years later — and
when it must be pixel-stable it should ship with a subset font embedded or its text converted to
paths, chosen per invocation rather than globally.

#### When to revisit

Option 3 becomes the right answer only under a concrete pressure that does not exist today: rendering
at volume without Chrome (a hosted sharing layer doing thousands of renders, where a browser per
render is the cost driver). Until then it is a second truth bought with no buyer.

### Q3 — Resolved: one honest kind, not an open vocabulary and not shapes alone

**Decision: Option B.** Add exactly one element kind — `Concept` — meaning *a named thing in an
argument, asserting nothing about a system*. Free-form shapes (D2) remain the answer for ink. No
user-defined kinds, no `Note`-as-general-escape-hatch, no shapes-only figure format.

#### What the question really was

The experiment had to draw an essay's argument, and Stemma's only vocabulary is C4 + DDD. So it
declared *"Contracts at the seams"* a `Module`, *"What the repository can answer"* a
`BoundedContext`, and XP practices `Capability`. It compiles. `RuleEngine` is satisfied. And it is
false in the one way this product exists to prevent: **the model asserts a bounded context that does
not exist.** A tool whose thesis is *the diagram cannot lie* shipped a diagram that lies, because the
vocabulary left no honest way to say what the author meant.

Worth separating, because it changes the answer: **not all of the experiment was abuse.** The four
`Question` elements — *"What breaks if this is wrong?"* — are exactly what `Question` is for.
`Question`/`Assumption`/`Risk` are already a non-structural sub-vocabulary: commentary with ids and
an `AboutId`, making no claim about system shape. Stemma therefore already accepts that not every
element models a system. The gap is narrower than "Stemma can't do arguments": it is that the
non-structural half stops at *concerns* and has no word for *things*.

#### The decisive fact, and why it does not settle the question

**An argument diagram has no referent.** There is no system behind *"nobody to ask"*, so it cannot
drift, cannot be validated against reality, and will never be re-projected for another audience. Every
benefit of having a model is null for this class. Taken alone that argues for shapes-only, or even for
"keep drawing these in draw.io" — which is a legitimate answer, and is the one the product's
*narrow scope* default would reach for.

It does not win, for two reasons. First, the stated goal is **one workflow**: 2–3 diagrams per post
mixing abstract and strict, and a maintainer who must not context-switch tools mid-post. Second, and
more concretely, the machinery an argument diagram *does* want — ids, labelled arrows, view
membership, the layout DSL (C2), the publication profile (D3), the render pipeline (B1) — is
machinery Stemma is building anyway, and most of it hangs off elements having ids.

#### The options considered

| | Approach | Honest | Keeps the machinery | Cost |
|---|---|---|---|---|
| A | Shapes only, empty model — argument diagrams are pure presentation | ✓ | ✗ no ids, no links, no views | low, but rebuilds a worse draw.io |
| **B** | **One neutral element kind (`Concept`)** | **✓** | **✓ all of it** | **medium — 6 engine files, ~10 client files, fidelity fixtures** |
| C | Workspace-defined custom kinds (UML-stereotype / ArchiMate-profile style) | ✓ | ✓ | high; `Stemma.Model` stops being a closed vocabulary |
| D | Two document types: "model workspace" vs "figure" | ✓ | partly | high product surface; concedes the positioning |
| — | *Status quo: reuse `Module`/`BoundedContext`* | **✗** | ✓ | zero, and it already shipped a false diagram |

Option C is the intellectually cleanest and is what ArchiMate does. It is also IDE-creep: an open
vocabulary means the reader, writer, validator, renderer, and inspector all stop being able to reason
about kinds. `CLAUDE.md`'s default — *narrow scope, push back on IDE-creep* — applies, and the
concrete need is one kind, not a system for kinds.

Option D reuses the new investment well (layout DSL, palettes, profile and CLI are all
presentation-side and indifferent to whether a model exists), but "Stemma also has a drawing mode"
is a positioning cost the README spends four paragraphs arguing against.

#### Why B, in one line

**You cannot prevent an escape hatch; you can only choose whether it is labelled.** The status quo is
not "no escape hatch" — it is "the escape hatch is `Module`, and using it corrupts a kind that means
something". An explicit `Concept` quarantines the same behaviour into a kind where it does no
semantic damage, and makes it greppable: `grep -c "new Concept(" Architecture.cs` tells you instantly
whether you are looking at an architecture or at a figure.

The usual objection — *"a kind that means nothing is anti-structural, and everyone will reach for
it"* — is real but is an argument for documentation and for `validate`, not against the kind. It is
also already true, just hidden.

#### What Option B means concretely

- **`Concept(Id, Name)` in `Stemma.Model`**, with no `ContextId`, no `SystemId`, no lifecycle or
  ownership semantics, and no membership in the `moduleMap` or `dependencyGraph` lenses. It is
  deliberately the poorest element in the vocabulary; that poverty is the whole point.
- **It renders as a plain box.** In the `publication` profile (D3) that is automatic —
  `visibleFields: ['name']` already strips the kind chip. In the app it gets a neutral card with no
  icon colour of its own.
- **`validate` (A4) grows two soft checks:** warn when a workspace mixes `Concept` with structural
  kinds *inside one view* (they are different rhetorical registers and the picture will read as
  neither), and note when a model is majority-`Concept` — *"this is a figure, not an architecture"* —
  which is information, not an error.
- **Adding a kind is engine work, and the process applies.** `ArchElementKind` is referenced across
  six engine files (`DslReader`, `DslWriter`, `StemmaEngine`, `SeedRules`, and both exporters) and
  roughly ten client files. Per `CLAUDE.md`, `AddElementOp` for the new kind needs **≥3 round-trip
  fixtures — minimal, realistic, pathological — written before the implementation.** This is not a
  one-line change and should not be estimated as one.

#### The boundary: what is a `Concept` and what is ink

These are complements, not alternatives, and the line is worth stating because getting it wrong
recreates the same problem one level down:

| | Use | Because |
|---|---|---|
| **`Concept`** (model) | a node in the argument's graph — something arrows connect, something a view includes | it needs an id, a position under the layout DSL, and view membership |
| **Shape** (presentation, D2) | swimlane labels (`human` / `agent`), brackets, callouts, a dashed frame around a group | it is annotation on the drawing; it participates in no relation |

The published draw.io benchmark uses both: six boxes and two text labels. Under this decision the
boxes become `Concept`s and the labels stay `ShapeLabel`s — which is exactly the split draw.io's own
`vertex` vs `style=text` distinction encodes.

#### The sub-decision this defers: a neutral link kind

If `Module` was a lie for a box, `Dependency` is the same lie for an arrow between two ideas. Three
things are true and pull in different directions:

- `Dependency(Kind: "…")` carries free text, and **the label is what renders**, so the picture is
  already correct today — the dishonesty is confined to the source.
- `Question`/`Assumption`/`Risk` express relation through `AboutId`, not a link — and those edges are
  **synthesised client-side** (`ArchCanvas.tsx:533`, `__about__<id>`). They are not model links, so
  they have no id, cannot be styled, and cannot carry a custom label. That is precisely why the
  published PNG shows four generic dashed lines labelled with the literal word *"about"*.
- A third link kind — `Relation(Id, FromId, ToId, Label)` — fixes both, at the cost of another
  vocabulary addition and another set of fidelity fixtures.

**Deferred, not rejected.** Ship `Concept` with `Dependency` first; add `Relation` when an argument
diagram needs a labelled concept-to-concept arrow that must also be *styled* (dashed for the broken
path, accent for the answer — both of which the benchmark uses). The cost of waiting is a slightly
dishonest word in a source file nobody publishes; the cost of building both at once is doubling the
riskiest part of the work.

#### What stays true regardless

`Concept` does not make an argument diagram into architecture, and nothing in Stemma should pretend
otherwise. It is a box with an id in a workspace that lives under `drafts/diagrams/<slug>/` and models
an essay. The honesty comes from the name, not from the machinery.

#### When to revisit

Option C — user-defined kinds — earns another look only if a *second* domain shows up that needs its
own vocabulary and cannot be served by `Concept` plus custom properties (`customProps` already
carries arbitrary key/values per element). One essay series is not that signal. Two unrelated
consumers asking for stereotypes would be.

### Q4 — Resolved: ship the technique, not the brand

**Decision: Stemma ships a built-in `dual-theme` palette derived from a general constraint, plus a
handful of neutral named palettes. The blog's specific colours live in the blog's repository and
arrive as a render argument.** No customer's brand ships inside the product.

#### What the question really was

D3 (the `publication` profile) needs *some* ink to draw with, so it must have a default. The
temptation is to make that default the blog's — `#767884` stroke, `#6366E8` accent, transparent
ground — because that is the only palette anyone has validated. Do that and the profile is not
"publication", it is "bfrackowiak.pl", and the second user gets colours that mean nothing to them.

#### The observation that resolves it

The blog's palette is not an arbitrary brand choice. It is the answer to a **general constraint**,
stated in the house style itself: *no single colour reaches 4.5:1 against both `#fbfbfd` and
`#0f1014`; the balanced optimum is about 4.3:1, and this is it (4.27 light / 4.37 dark)*.

That constraint — *one ink that stays legible on a page whose background the author does not control
at render time* — belongs to **every** transparent-background diagram export, for every dual-theme
site, every dark-mode-capable wiki, and every slide deck that might be shown on either. It is a
solved design problem, and solving it is exactly the kind of thing a tool should carry.

So: **the hue is brand, the contrast rule is technique.** Ship the technique.

#### What that means concretely

- **A built-in `dual-theme` palette** is the `publication` profile's default: a neutral grey computed
  to the same dual-background optimum, a neutral accent, transparent ground, no fills. It reproduces
  the blog's *reasoning* without its identity — and the blog's own file then overrides little more
  than the accent.
- **Two or three other built-ins** for the cases that are not dual-theme: `print` (dark ink, opaque
  white), `slide` (heavier strokes, larger type). Named, not numbered.
- **Palettes are a render argument, not workspace state.** `--palette <name>` resolves a built-in;
  `--palette ./blog.palette.json` resolves a file. This is the same category as `--scale 2` — nobody
  argues that scale belongs in the sidecar, and nothing about a palette is more workspace-bound than
  that. **It is therefore not a third store**, which matters, because the alternative was tempting
  and wrong: a `palettes` section duplicated into every one of ~30 per-post workspaces, where
  changing the site's accent means editing thirty files and the palette drifts from the site exactly
  as diagrams drift from code. That failure mode is the one this whole product exists to argue
  against; reproducing it one level up would be embarrassing.
- **The sidecar may name a default** (`"palette": "dual-theme"` or a relative path) so opening the
  workspace in the app previews what will ship. A name is a reference, not a copy; `validate` (A4)
  reports a dangling one.
- **`validate` enforces the accessibility rule** the current export breaks: refuse — or at minimum
  warn on — a palette that distinguishes states by hue alone, without a second channel (line style,
  position, weight, label). Stemma's own status badges fail this today.

This supersedes D4's original phrasing, which put a `palettes` section in the sidecar. The section
survives only as an optional *default name*.

#### When to revisit

If a palette ever needs to vary per view within one workspace (a book with an executive deck and an
engineering deck in different inks), the reference moves from workspace-level to view-level. Cheap
either way; not worth building before someone asks.

### Q5 — Resolved: one short-lived process per render

**Decision: `stemma render` starts its own backend on an ephemeral port with `--workspace <path>`,
renders, and kills it.** No multi-workspace `EngineHost`, no shared server, no change to the web
layer at all.

#### What the question really was

`EngineHost` holds exactly one engine and `POST /api/workspace/open` swaps it (G7). Three
consequences, all of them visible in the experiment: rendering **mutates whatever the maintainer had
open**, two renders cannot run at once, and `capture.mjs` re-opens the workspace four times because
that is the only reset it has.

#### The options considered

| | Approach | Isolation | Blast radius | Per-render cost |
|---|---|---|---|---|
| A | Multi-workspace `EngineHost` — a registry keyed by root path, workspace id on every request | ✓ | every endpoint, the SignalR hub, and the client store all assume one active workspace | low |
| **B** | **A short-lived process per render** | **✓** | **none — `run.sh --workspace` already does this** | **a few seconds** |
| C | Status quo: serial renders that stomp the open workspace | ✗ | none | none |
| D | No backend at all — `Stemma.Cli` reads the workspace through `Stemma.Engine` and injects the model into the page | ✓ | a second data path into the canvas | lowest |

**Why not A.** It is the "proper" answer and it is a broad refactor of the web layer plus a lifetime
policy (when is a Roslyn workspace evicted? they are not small) in exchange for saving seconds on a
job that runs two or three times a week. It also puts the maintainer's daily-driver app at risk for
a batch use case.

**Why not D**, tempting as it is. `Stemma.Cli` already references `Stemma.Engine`, so it genuinely
could load model, views and sidecar itself and hand them to the page as an injected payload — no
ASP.NET boot, no port, no SignalR. But it gives the canvas **two ways to be fed**, and this document
has argued twice already (§8 · Q2) that a second path is a second truth. Here the fork is narrower —
data loading, not rendering — so D is the strongest fallback if B's startup cost ever becomes a real
complaint. It is not one today.

**Why B.** It is the least clever option available. It reuses `run.sh --workspace`, which already
auto-opens a workspace at boot, so the capability is half-built. It changes no shared state, needs no
eviction policy, contains crashes, and leaves the maintainer's open workspace untouched — which is a
property worth more day to day than the seconds it costs. Renders are not a hot path: two or three
diagrams, weekly.

#### What Option B means concretely

- `stemma render` boots `Stemma.Web` on an ephemeral port with the target workspace, waits for the
  render route's readiness signal (B2), captures, and tears the process down in a `finally`.
- **Parallelism is bounded.** Each render holds an ASP.NET host, a Roslyn workspace, and a Chrome
  instance; a post's worth of diagrams is fine, a hundred is not. Cap concurrency (2–4) and document
  the reason rather than discovering it as an out-of-memory.
- Failure is per-diagram. One bad view does not poison the batch.

#### When to revisit

Option A becomes right under exactly one pressure — **rendering on demand at volume**, e.g. a hosted
sharing layer where process-per-render is the cost driver. That is the same trigger recorded for
Q2's standalone renderer, and it is not a coincidence: both defer the same "make it cheap at scale"
work. **If that pressure arrives, reopen Q2 and Q5 together**, because the answer is likely one
design (a headless, browser-free, multi-workspace render service) rather than two.

### Q6 — Resolved: deterministic constraints stay live, heuristic layouts stay one-shot

**Decision: split the two by whether they are reproducible.** A *deterministic* constraint (grid,
row, column, stack) stays live in the sidecar and is adjusted by **per-node offsets**; solved
coordinates are not committed. A *heuristic* layout (force, hierarchical, byType) stays what it is
today — a one-shot generator that bakes absolute coordinates and hands the view to `custom`.

**This supersedes the recommendation originally written into C2** ("solved to coordinates at load,
cached into `nodes` so manual nudges still work"), which does not survive contact with how the canvas
actually behaves.

#### Why the original recommendation was wrong

`ArchCanvas.tsx:936` — the drop handler — runs
`setViewLayout(String(layoutKey), 'custom')` after **any** drag. Dragging one node takes the *entire
view* off its layout, permanently. Under the original proposal that means: author a seven-box grid,
nudge one label 12px to line it up with an arrow, and the grid is gone. Add a box next week and there
is nothing left to re-solve — you are back to hand-placing all seven.

The flip is correct for a heuristic layout (a force-directed arrangement you have started correcting
by hand is no longer force-directed) and destructive for a constraint (a grid with one nudged cell is
still a grid). Treating both the same way is the mistake.

#### The options considered

| | Approach | Agent can author | Human can nudge | Constraint survives an edit |
|---|---|---|---|---|
| A | DSL replaces coordinates entirely | ✓ | ✗ | ✓ |
| B | DSL solves, caches into `nodes`, first drag flips to `custom` *(originally proposed)* | ✓ | ✓ once | ✗ |
| **C** | **DSL stays live; a drag records an offset from the solved position** | **✓** | **✓** | **✓** |

C is what every serious layout system does — CSS flex plus `position: relative`, Figma auto-layout
plus manual overrides. The nudge is expressed against the constraint instead of destroying it.

#### What Option C means concretely

- **A drag on a constrained view stores `offsets[id] = dragged − solved[id]`**, not an absolute. The
  view stays on its constraint.
- **Rendered position is `solved[id] + (offsets[id] ?? {0,0})`.** The solver already has to run at
  load, so it is available at drop time too; this is roughly thirty lines plus edge cases.
- **Solved coordinates are not committed.** The sidecar holds the constraint and the offsets. Diffs
  become semantic — `offsets.q_why: [0, 12]` instead of `x: -107.3846153846154` — which for a
  Git-centric product is most of the point. Views with no constraint keep absolute `nodes` exactly as
  today.
- **Heuristic layouts are unchanged.** `force`/`hierarchical`/`byType` remain a button that computes
  positions once and writes them; the view becomes `custom`; the coordinates are committed. This is
  not a compromise, it is the correct behaviour — **an iterative force-directed solve is not
  guaranteed stable across versions**, and a published diagram that silently re-arranges when the
  algorithm is tuned would break B5's staleness hash and the "cannot lie" promise with it. Bake them.
- **Edge cases to specify in the feature record:** a node absent from the constraint falls back to
  absolute `nodes[id]`; a node removed from the constraint keeps its last solved position, baked;
  removing the constraint bakes all solved+offset positions into `nodes`; "reset nudges" clears
  `offsets` for the view.

#### What stays true regardless

The split has a one-line test that is worth writing into the protocol doc (A2): **if re-running it
tomorrow must give the same picture, it is a constraint; if it is a starting point you will correct,
it is a generator.** Constraints are for the seven-box argument diagrams, where the arrangement
carries the meaning. Generators are for the twenty-element architecture views, where you want
something reasonable fast and will then adjust it.

#### When to revisit

If constraints ever need to nest (a grid whose cell is itself a row), the offset model still holds
but the solver gains a tree. Not needed for anything in the current workload; do not build it
speculatively.

---

## 9. Feature records this should spawn

Per `features/README.md`, nothing graduates without a record. Suggested split, all serving the new
**Essayist's Agent** persona (which `users-and-personas.md` should gain):

| Proposed | Title | Horizon |
|---|---|---|
| F-004 | Headless diagram render (`stemma render`) | Next |
| F-005 | Publication render profile & named export palettes | Next |
| F-006 | Declarative layout DSL in the presentation sidecar | Next |
| F-007 | Sidecar schema, protocol reference, and workspace `STEMMA.md` | Next |
| F-008 | Render manifest & staleness detection | Later |
| F-009 | True vector output from the publication profile (§8 · Q2) | Later |
| F-010 | The `Concept` element kind (§8 · Q3) — **the one engine change; needs an ADR** | Next |

And one bug, which should be filed and fixed independently of all of the above:

| Proposed | Title |
|---|---|
| B-001 | `PUT /api/workspace/layout` silently discards `views.*.shapes` and `views.*.edges.*.handles` |

---

## 10. Sources

- The experiment: `bfrackowiak.pl/drafts/diagrams/we-deleted-the-wrong-half-of-agile/` — `capture.mjs`
  and the `Reviewability/` workspace.
- The published outputs: `bfrackowiak.pl/assets/img/posts/we-deleted-the-wrong-half-of-agile/`
  (Stemma) versus `…/the-bottleneck-moved/who-do-you-ask.png` (draw.io).
- The contract: `bfrackowiak.pl/docs/POST-PROMPT.md` § *Diagrams*.
- Stemma: `ArchCanvas.tsx:794-836` (export), `ArchNodeView.tsx:361` (truncation),
  `lib/layout.ts` + `lib/store.ts:42-49` (sidecar and layout mode),
  `Workspace/LayoutSidecar.cs:37-53` (dropped sections), `Program.cs:129-149` (exporters),
  `ArchModel/DrawioExporter.cs`, `ArchModel/MermaidExporter.cs`, `lib/autoLayout.ts`, `lib/shapes.ts`.
