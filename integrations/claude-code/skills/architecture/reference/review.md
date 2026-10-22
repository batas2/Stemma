# Reviewing an architecture

A review is what `validate` and the lint cannot do alone: judging whether the model says the right
things, at the right level, in words the receiving team will understand. Do the mechanical checks first,
then read.

## 1. Mechanical

```
stemma validate <ws> --json          # model, views, rules, conformance
stemma inspect --view <id> --json    # per view: what is drawn and what is left out
stemma render --workspace <ws> --view <id> --out /tmp/review-<id>.png --json   # layout findings
```

## 2. The C4 checklist, per view

From [c4model.com/diagrams/checklist](https://c4model.com/diagrams/checklist):

- **Title and scope** — the view's name says what it shows; one question per view.
- **Abstraction level** — one level per view: systems with systems, containers with containers. A view
  mixing containers and modules is reported (`view/mixed-levels`) and is usually two views.
- **Every element** has a name a newcomer understands, a clear type, a technology (containers) and a
  description.
- **Every relationship** has a label that says what moves or why, reads correctly in the arrow's
  direction ("places orders", not "orders"), and a technology where it crosses a process boundary.
- **No orphans** — an element with no relationship in a view is either missing a link or missing from
  the reason for the view.
- **Legend** — the colours and line styles mean something; status (as-is / to-be) is not carried by
  colour alone.

## 3. Design

- Does every rule the user stated exist in `Rules/`, and pass?
- Are there single points of failure, shared databases between services, synchronous chains longer
  than three calls, cycles between services?
- Where does the design cross a trust boundary (the internet, a third party), and do those flows say how
  (`HTTPS`, auth)?
- Is anything to-be not tagged as such, so the picture claims it exists today?
- If the code is mapped, what does conformance say?

## 4. Report

For each finding: where (view / element / link id), what is wrong, why it matters, and the change you
propose. Lead with what would mislead the receiving team; end with polish. Offer to make the changes.
