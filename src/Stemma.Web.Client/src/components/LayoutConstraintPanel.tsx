import { useEffect, useState } from 'react';
import { Columns3, Rows3, Grid3x3, Layers, Trash2, RotateCcw, Network, ArrowDown, ArrowRight, ArrowUp, ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import {
  loadViewConstraint, loadViewLayered, saveViewConstraint, loadViewOffsets, clearViewOffsets, loadLayout,
} from '@/lib/layout';
import type { LayeredConstraint, LayeredDirection } from '@/lib/layeredLayout';
import type { ViewKind } from '@/lib/types';
import { constraintIds, constraintFromSelection, danglingIds, type LayoutConstraint, type LayoutConstraintKind } from '@/lib/layoutDsl';

/**
 * Authoring a layout constraint from the canvas.
 *
 * The constraint was authorable as text before this existed, which served the agent fully and the
 * architect only through an editor. This is the other half: pick some boxes, say what shape they
 * make, and the same solver the headless render uses places them.
 *
 * It is deliberately a small surface. A constraint is a *statement about the arrangement*, not a
 * drawing tool — the four shapes below are the ones that hold their meaning when a box is added
 * next week, which is the whole reason to prefer them over dragging.
 *
 * Layers (F-021) is the fifth and is different in kind: it governs the whole view rather than a
 * selection, and ELK solves it — the arrangement for an architecture, where the four shapes are for a
 * figure whose arrangement is its argument.
 */

const DIRECTIONS: { value: LayeredDirection; label: string; icon: typeof ArrowDown }[] = [
  { value: 'down', label: 'Top to bottom', icon: ArrowDown },
  { value: 'right', label: 'Left to right', icon: ArrowRight },
  { value: 'up', label: 'Bottom to top', icon: ArrowUp },
  { value: 'left', label: 'Right to left', icon: ArrowLeft },
];

const SHAPES: { kind: LayoutConstraintKind; label: string; icon: typeof Grid3x3; hint: string }[] = [
  { kind: 'row', label: 'Row', icon: Columns3, hint: 'Left to right, in selection order.' },
  { kind: 'column', label: 'Column', icon: Rows3, hint: 'Top to bottom, in selection order.' },
  { kind: 'grid', label: 'Grid', icon: Grid3x3, hint: 'Columns of equal length, filled top to bottom.' },
  { kind: 'stack', label: 'Stack', icon: Layers, hint: 'Overlapping, offset by a fixed step.' },
];

export function LayoutConstraintPanel({ layoutKey }: { layoutKey: string }) {
  const workspace = useApp((s) => s.workspace);
  const arch = useApp((s) => s.arch);
  const selectedIds = useApp((s) => s.canvasSelectedIds);
  const setToast = useApp((s) => s.setToast);

  const [constraint, setConstraint] = useState<LayoutConstraint | null>(null);
  const [layered, setLayered] = useState<LayeredConstraint | null>(null);
  // A view nobody has arranged is laid out in layers without saying so in the file (F-021 AC4).
  const [unarranged, setUnarranged] = useState(false);
  const [nudgeCount, setNudgeCount] = useState(0);
  const [rows, setRows] = useState(2);

  // Re-read on every view change and whenever the canvas re-solves, so the panel never claims a
  // constraint the canvas is not honouring.
  useEffect(() => {
    if (!workspace) return;
    function refresh() {
      if (!workspace) return;
      const shape = loadViewConstraint(workspace.rootPath, layoutKey);
      const layers = loadViewLayered(workspace.rootPath, layoutKey);
      setConstraint(shape);
      setLayered(layers);
      setUnarranged(!shape && !layers && Object.keys(loadLayout(workspace.rootPath, layoutKey as ViewKind)).length === 0);
      setNudgeCount(Object.keys(loadViewOffsets(workspace.rootPath, layoutKey)).length);
    }
    refresh();
    window.addEventListener('stemma:layout-changed', refresh);
    window.addEventListener('stemma:sidecar-primed', refresh);
    return () => {
      window.removeEventListener('stemma:layout-changed', refresh);
      window.removeEventListener('stemma:sidecar-primed', refresh);
    };
  }, [workspace, layoutKey]);

  if (!workspace) return null;

  function apply(kind: LayoutConstraintKind) {
    if (!workspace || selectedIds.length < 2) return;
    const next = constraintFromSelection(kind, selectedIds, rows);
    saveViewConstraint(workspace.rootPath, layoutKey, next);
    // Nudges are deltas against the *previous* arrangement; keeping them across a reshape would
    // scatter the new one by whatever the old corrections happened to be.
    clearViewOffsets(workspace.rootPath, layoutKey);
    setConstraint(next);
    setLayered(null);
    setNudgeCount(0);
    window.dispatchEvent(new CustomEvent('stemma:layout-changed'));
    setToast({ kind: 'success', text: `${kind} of ${selectedIds.length} elements` });
  }

  function applyLayers(direction: LayeredDirection = layered?.direction ?? 'down') {
    if (!workspace) return;
    const next: LayeredConstraint = { ...(layered ?? {}), kind: 'layered', direction };
    if (next.direction === 'down') delete next.direction;
    saveViewConstraint(workspace.rootPath, layoutKey, next);
    clearViewOffsets(workspace.rootPath, layoutKey);
    setLayered(next);
    setConstraint(null);
    setUnarranged(false);
    setNudgeCount(0);
    window.dispatchEvent(new CustomEvent('stemma:layout-changed'));
    if (!layered) setToast({ kind: 'success', text: 'Laid out in layers, edges routed' });
  }

  function remove() {
    if (!workspace) return;
    // Bake before clearing: dropping a constraint must not move anything on screen.
    window.dispatchEvent(new CustomEvent('stemma:bake-constraint', { detail: { layoutKey } }));
    saveViewConstraint(workspace.rootPath, layoutKey, null);
    clearViewOffsets(workspace.rootPath, layoutKey);
    setConstraint(null);
    setLayered(null);
    setNudgeCount(0);
    window.dispatchEvent(new CustomEvent('stemma:layout-changed'));
    setToast({ kind: 'info', text: 'Constraint removed; positions kept' });
  }

  function resetNudges() {
    if (!workspace) return;
    clearViewOffsets(workspace.rootPath, layoutKey);
    setNudgeCount(0);
    window.dispatchEvent(new CustomEvent('stemma:layout-changed'));
    setToast({ kind: 'success', text: 'Nudges cleared' });
  }

  const governed = constraint ? constraintIds(constraint).length : 0;
  const active = constraint ?? layered;
  // A constraint naming an element that has since been removed places nothing and says nothing —
  // the box is simply absent from an arrangement that still claims to include it.
  const dangling = constraint && arch ? danglingIds(constraint, arch.elements.map((e) => e.id)) : [];

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-medium">Constraint</h3>
        {constraint && <span className="text-[10px] text-zinc-500">{constraint.kind} · {governed} elements</span>}
        {layered && <span className="text-[10px] text-zinc-500">layers · whole view</span>}
      </header>

      <p className="text-[11px] text-zinc-500 leading-snug">
        A constraint stays live: nudging one box records an offset against it instead of replacing
        it, so adding an element later re-solves and keeps your corrections.
      </p>

      {layered && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Direction</div>
          <div role="radiogroup" aria-label="Direction of the layers" className="inline-flex rounded-md border border-default overflow-hidden">
            {DIRECTIONS.map(({ value, label, icon: Icon }) => {
              const on = (layered.direction ?? 'down') === value;
              return (
                <button
                  key={value}
                  role="radio"
                  aria-checked={on}
                  aria-label={label}
                  title={label}
                  onClick={() => { if (!on) applyLayers(value); }}
                  className={clsx('px-2.5 py-1.5 transition-colors',
                    on ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800')}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {active ? (
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-ghost border-default" onClick={remove}>
            <Trash2 className="w-3 h-3" /> Remove
          </button>
          <button
            className="btn btn-sm btn-ghost border-default disabled:opacity-40"
            disabled={nudgeCount === 0}
            onClick={resetNudges}
            title={nudgeCount === 0 ? 'Nothing has been nudged' : `${nudgeCount} nudged`}
          >
            <RotateCcw className="w-3 h-3" /> Reset nudges{nudgeCount > 0 ? ` (${nudgeCount})` : ''}
          </button>
        </div>
      ) : unarranged ? (
        <p className="text-[11px] text-zinc-500">
          Nobody has arranged this view, so it is laid out in layers. Nudge a box, or choose a shape
          below, and the arrangement becomes this view&apos;s own.
        </p>
      ) : (
        <p className="text-[11px] text-zinc-500">No constraint — positions on this view are absolute.</p>
      )}

      {!layered && (
        <button
          className="btn btn-sm btn-ghost border-default w-full justify-start"
          title="Lay the whole view out in layers that follow its relationships, with every edge routed around the boxes"
          onClick={() => applyLayers('down')}
        >
          <Network className="w-3 h-3" /> Lay out in layers
        </button>
      )}

      {dangling.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {dangling.length === 1 ? 'One element is' : `${dangling.length} elements are`} named by this
          constraint but no longer in the model: {dangling.join(', ')}.
        </p>
      )}

      <div className="space-y-1 pt-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          {selectedIds.length < 2 ? 'Select two or more elements' : `From ${selectedIds.length} selected`}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {SHAPES.map(({ kind, label, icon: Icon, hint }) => (
            <button
              key={kind}
              className="btn btn-sm btn-ghost border-default justify-start disabled:opacity-40"
              disabled={selectedIds.length < 2}
              title={hint}
              onClick={() => apply(kind)}
            >
              <Icon className="w-3 h-3" /> {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-zinc-500 pt-1">
          Grid rows
          <input
            type="number"
            min={1}
            max={12}
            value={rows}
            onChange={(e) => setRows(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
            className="w-14 bg-transparent border border-default rounded px-1 py-0.5 text-xs"
          />
        </label>
      </div>
    </section>
  );
}
