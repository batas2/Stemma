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

## 5. The review loop

An architect reviews the model in the Stemma app and leaves comments on the cards — "should this be
asynchronous?", "wrong level for this view". They live in `comments.stemma.json` beside the model, and
the app shows each card's open count. Work through them from the command line; the app shows your
replies as you write them.

```
stemma comments <ws>                       # open comments, each with what it is on and its thread
stemma comments <ws> --json                # the same, for you to act on
stemma comments <ws> --on cnt_api          # one element's, link's or view's
stemma comments reply   <id> "<text>"   --workspace <ws>
stemma comments resolve <id> "<what was done>" --workspace <ws>   # reply and resolve
stemma comments reopen  <id>            --workspace <ws>
stemma comments add --on <id> "<text>"  --workspace <ws>          # start one: a finding, a question
```

Text may be `-` to read it from standard input, for anything longer than a line. Replies you write are
signed *Claude* when you run inside Claude Code; pass `--author` only to sign them otherwise.

- **Resolve only what you did**, with a reply saying what changed, in one sentence a reader of the card
  understands without the diff: "Made the order hand-off a queue (`cnt_queue`); the API no longer writes
  to the DB directly."
- **An answer without a change stays open** — reply, and let the architect resolve it.
- **A disagreement is a reply, not a resolution**: say why, propose the alternative, leave it open.
- **A comment on something that is gone** is listed as *no longer in the model*: say where it went, or
  why it went, and resolve it.

When the work is done, say what it did to the model:

```
stemma diff <ws>                 # since where this branch started, or the last commit on the default branch
stemma diff <ws> --base main     # since any revision
stemma diff <ws> --markdown      # a section for the pull request's description
stemma diff <ws> --json
```

It lists what was added, removed and changed — renamed, moved, a new technology, an arrow that now goes
the other way — in the words the app's *What changed* uses, and the review comments opened and resolved
since.
