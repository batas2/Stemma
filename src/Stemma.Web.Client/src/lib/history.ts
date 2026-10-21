/**
 * The one undo history a person sees (F-015 AC6).
 *
 * Three things can be undone, and each is kept where it belongs: a model edit on the engine's stack
 * (Git-reviewable code), a move on the layout stack (`layoutUndo`), and a change of appearance as the
 * values it replaced. Before this journal, ⌘Z asked the layout stack first and the engine second, so a
 * box moved *before* an edit was put back before the edit was; and a paste of five boxes took five
 * presses. The journal records, in the order they happened, which stack each step went to — and how
 * many engine operations a step was made of — so ⌘Z undoes the last thing done, whatever it was.
 *
 * It never holds a model edit itself: undoing one is still the engine's undo, run once per operation
 * the step was made of. A grouped step is undone together only while the engine's stack is as deep as
 * it was when the step ended; anything else means someone else has edited since, and one operation is
 * undone instead of guessing which of them were ours.
 *
 * Pure apart from the driver it is handed, so the order and grouping rules test without a server.
 */

/**
 * A presentation section a step can change: one entry, keyed by element or relationship id — or,
 * for `position`, where an element sits on one view (`view` names it).
 */
export type PresentationSection = 'nodeStyles' | 'edgeStyles' | 'notes' | 'customProps' | 'position';

export interface PresentationChange {
  section: PresentationSection;
  id: string;
  /** The view a `position` is on. */
  view?: string;
  /** The entry before the step; undefined when there was none. */
  before: unknown;
  /** The entry after the step; undefined when the step removed it. */
  after: unknown;
}

export interface HistoryStep {
  description: string;
  /** A drag the layout stack holds. */
  layout: boolean;
  /** How many engine operations the step was made of. */
  ops: number;
  presentation: PresentationChange[];
  /** The engine's undo depth when the step ended; null when it was not asked (a single operation). */
  depthAfter: number | null;
  /** The engine's redo depth after the step was undone, for the same check on the way back. */
  redoDepthAfter: number | null;
  /** When the step was last added to, and what it is about — for folding a run of small edits into one. */
  at: number;
  key: string | null;
}

export interface HistoryDriver {
  undoLayout(): boolean;
  redoLayout(): boolean;
  undoOperation(): Promise<boolean>;
  redoOperation(): Promise<boolean>;
  /** The engine's stack depths, or null when they cannot be read. */
  depths(): Promise<{ undo: number; redo: number } | null>;
  applyPresentation(changes: PresentationChange[], which: 'before' | 'after'): void;
}

const CAPACITY = 100;
/** Edits to one thing within this long are one step: dragging a slider is one change, not forty. */
export const COALESCE_MS = 1000;

interface OpenGroup {
  description: string;
  ops: number;
  presentation: PresentationChange[];
}

function step(description: string, at: number, over: Partial<HistoryStep> = {}): HistoryStep {
  return { description, layout: false, ops: 0, presentation: [], depthAfter: null, redoDepthAfter: null, at, key: null, ...over };
}

/** `changes` folded into `into`: the first `before` of an entry and the last `after` are kept. */
function fold(into: PresentationChange[], changes: PresentationChange[]): void {
  for (const c of changes) {
    const existing = into.find((x) => x.section === c.section && x.id === c.id && x.view === c.view);
    if (existing) existing.after = c.after;
    else into.push({ ...c });
  }
}

export class History {
  private undoSteps: HistoryStep[] = [];
  private redoSteps: HistoryStep[] = [];
  private group: OpenGroup | null = null;
  /** While the journal is itself undoing or redoing, what that does is not a new step. */
  private replaying = false;
  private listeners = new Set<() => void>();

  constructor(private readonly driver: HistoryDriver, private readonly now: () => number = () => Date.now()) {}

  get canUndo(): boolean { return this.undoSteps.length > 0; }
  get canRedo(): boolean { return this.redoSteps.length > 0; }
  get undoDescription(): string | null { return this.undoSteps[this.undoSteps.length - 1]?.description ?? null; }
  get redoDescription(): string | null { return this.redoSteps[this.redoSteps.length - 1]?.description ?? null; }
  get isReplaying(): boolean { return this.replaying; }

  /** A drag the layout stack has just taken. */
  recordLayout(description: string): void {
    if (this.replaying) return;
    this.push(step(description, this.now(), { layout: true }));
  }

  /** An engine operation this window applied. Inside a group it becomes part of the group. */
  recordOperation(description: string): void {
    if (this.replaying) return;
    if (this.group) { this.group.ops++; return; }
    this.push(step(description, this.now(), { ops: 1 }));
  }

  /**
   * A change of appearance. Successive changes to the same thing (`key`) fold into one step while
   * they come within `COALESCE_MS` of each other; inside a group they are part of the group.
   */
  recordPresentation(changes: PresentationChange[], description: string, key: string | null = null): void {
    if (this.replaying || changes.length === 0) return;
    if (this.group) { fold(this.group.presentation, changes); return; }
    const t = this.now();
    const top = this.undoSteps[this.undoSteps.length - 1];
    if (key && top && top.key === key && top.ops === 0 && !top.layout && t - top.at < COALESCE_MS) {
      fold(top.presentation, changes);
      top.at = t;
      this.redoSteps = [];
      this.notify();
      return;
    }
    const s = step(description, t, { key });
    fold(s.presentation, changes);
    this.push(s);
  }

  /** Start one step made of several: what is recorded until `endGroup` is undone together. */
  beginGroup(description: string): void {
    if (this.replaying) return;
    this.group = { description, ops: 0, presentation: [] };
  }

  /** Close the group; `depthAfter` is the engine's undo depth now, when there was more than one operation. */
  endGroup(depthAfter: number | null = null): void {
    const g = this.group;
    this.group = null;
    if (!g || (g.ops === 0 && g.presentation.length === 0)) return;
    this.push(step(g.description, this.now(), { ops: g.ops, presentation: g.presentation, depthAfter }));
  }

  get groupOpen(): boolean { return this.group !== null; }

  /** Something outside this window changed the files: what was undone can no longer be redone. */
  dropRedo(): void {
    if (this.redoSteps.length === 0) return;
    this.redoSteps = [];
    this.notify();
  }

  /** Undo the last step. Returns what was undone, or null when there was nothing to undo here. */
  async undo(): Promise<string | null> {
    const s = this.undoSteps.pop();
    if (!s) return null;
    this.replaying = true;
    try {
      // The reverse of the order a step was made in: its looks were set after its elements existed.
      if (s.presentation.length > 0) this.driver.applyPresentation(s.presentation, 'before');
      if (s.ops > 0) {
        const together = s.ops === 1 || (s.depthAfter !== null && (await this.driver.depths())?.undo === s.depthAfter);
        const times = together ? s.ops : 1;
        for (let i = 0; i < times; i++) if (!(await this.driver.undoOperation())) break;
        if (!together) {
          // Someone else edited in between: one operation was undone, and the rest of this step cannot
          // be told apart from theirs. It is not offered for redo, which would replay a guess.
          this.notify();
          return s.description;
        }
        s.redoDepthAfter = s.ops > 1 ? (await this.driver.depths())?.redo ?? null : null;
      }
      if (s.layout) this.driver.undoLayout();
      this.redoSteps.push(s);
      this.notify();
      return s.description;
    } finally {
      this.replaying = false;
    }
  }

  async redo(): Promise<string | null> {
    const s = this.redoSteps.pop();
    if (!s) return null;
    this.replaying = true;
    try {
      if (s.layout) this.driver.redoLayout();
      if (s.ops > 0) {
        const together = s.ops === 1 || (s.redoDepthAfter !== null && (await this.driver.depths())?.redo === s.redoDepthAfter);
        const times = together ? s.ops : 1;
        for (let i = 0; i < times; i++) if (!(await this.driver.redoOperation())) break;
        if (!together) { this.notify(); return s.description; }
        s.depthAfter = s.ops > 1 ? (await this.driver.depths())?.undo ?? null : null;
      }
      if (s.presentation.length > 0) this.driver.applyPresentation(s.presentation, 'after');
      this.undoSteps.push({ ...s, at: this.now(), key: null });
      this.notify();
      return s.description;
    } finally {
      this.replaying = false;
    }
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private push(s: HistoryStep): void {
    this.undoSteps.push(s);
    while (this.undoSteps.length > CAPACITY) this.undoSteps.shift();
    this.redoSteps = [];
    this.notify();
  }

  private notify(): void { this.listeners.forEach((l) => l()); }
}

const unconfigured: HistoryDriver = {
  undoLayout: () => false,
  redoLayout: () => false,
  undoOperation: async () => false,
  redoOperation: async () => false,
  depths: async () => null,
  applyPresentation: () => {},
};

let current: HistoryDriver = unconfigured;

/** The app's journal. Its driver is set once by App, which is where the stacks it drives meet. */
export const history = new History({
  undoLayout: () => current.undoLayout(),
  redoLayout: () => current.redoLayout(),
  undoOperation: () => current.undoOperation(),
  redoOperation: () => current.redoOperation(),
  depths: () => current.depths(),
  applyPresentation: (changes, which) => current.applyPresentation(changes, which),
});

export function setHistoryDriver(driver: HistoryDriver): void {
  current = driver;
}
