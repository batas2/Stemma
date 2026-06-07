import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Wand2, Network, ChevronDown, Magnet, AlignLeft, AlignRight, AlignCenterHorizontal,
  AlignStartVertical, AlignEndVertical, AlignCenterVertical,
  StretchHorizontal, StretchVertical, Maximize2, Trash2, MousePointerSquareDashed,
  Crosshair, Filter, Target, LayoutDashboard,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { LayoutAlgorithm } from '@/lib/autoLayout';

interface Props {
  onAutoLayout: (algorithm: LayoutAlgorithm) => void;
  onAlign: (axis: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onFitSelection: () => void;
  onDeleteSelected: () => void;
  selectedCount: number;
}

// Defined at module scope so its component identity is stable across CanvasToolbar
// renders. Inlining it inside the parent caused unmount/remount of every toolbar
// button on every render, which on busy views (dependencyGraph / moduleMap, where
// arch refreshes via SignalR fire frequently) made the click target detach before
// the click could fire.
function Btn({
  onClick, title, active, children, disabled,
}: { onClick?: () => void; title: string; active?: boolean; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={clsx(
        'p-1.5 rounded transition-colors',
        active
          ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-200'
          : disabled
            ? 'text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100'
      )}
    >
      {children}
    </button>
  );
}

export function CanvasToolbar({ onAutoLayout, onAlign, onDistribute, onFitSelection, onDeleteSelected, selectedCount }: Props) {
  const snap = useApp((s) => s.snapEnabled);
  const toggleSnap = useApp((s) => s.toggleSnap);
  const canvasMode = useApp((s) => s.canvasMode);
  const view = useApp((s) => s.view);

  // Dependency-view state — surfaced inline on this toolbar when view === 'dependencyGraph'.
  const arch = useApp((s) => s.arch);
  const depFocusMode = useApp((s) => s.depFocusMode);
  const setDepFocusMode = useApp((s) => s.setDepFocusMode);
  const depKindFilter = useApp((s) => s.depKindFilter);
  const setDepKindFilter = useApp((s) => s.setDepKindFilter);
  const depDepth = useApp((s) => s.depDepth);
  const setDepDepth = useApp((s) => s.setDepDepth);

  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  // Close dropdowns when the user clicks anywhere outside their wrapper. Implemented at
  // document level using a non-capture `mousedown` so it doesn't intercept clicks on the
  // dropdown items themselves (those would otherwise lose their click before the item's
  // onClick fires). Capture-phase + pointerdown was breaking other toolbar buttons.
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!layoutMenuOpen && !filterOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node | null;
      // Don't close while the press is still inside the wrapper — let the inner onClick run.
      if (layoutMenuOpen && layoutMenuRef.current && (!t || !layoutMenuRef.current.contains(t))) {
        setLayoutMenuOpen(false);
      }
      if (filterOpen && filterMenuRef.current && (!t || !filterMenuRef.current.contains(t))) {
        setFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [layoutMenuOpen, filterOpen]);

  // The toolbar adapts to context: which view + what's selected.
  //   - shape tools only on a custom view (collapsible)
  //   - dep tools only on dependencyGraph view
  //   - alignment only when 2+ nodes selected
  //   - distribute only when 3+
  //   - selection count + delete only when 1+
  const hasSelection = selectedCount > 0;
  const canAlign = selectedCount >= 2;
  const canDistribute = selectedCount >= 3;
  const inShapeMode = canvasMode.kind === 'shape';
  const isDepView = view === 'dependencyGraph';

  const depKinds = useMemo(() => {
    if (!arch) return [];
    const set = new Set<string>();
    for (const l of arch.links) if (l.kind === 'dependency') set.add(l.attributes.kind ?? 'uses');
    return [...set].sort();
  }, [arch]);
  const allKindsActive = depKindFilter === null;
  const visibleKindCount = allKindsActive ? depKinds.length : (depKindFilter as Set<string>).size;
  function toggleKind(k: string) {
    if (allKindsActive) {
      setDepKindFilter(new Set(depKinds.filter((x) => x !== k)));
      return;
    }
    const next = new Set(depKindFilter as Set<string>);
    if (next.has(k)) next.delete(k); else next.add(k);
    if (next.size === depKinds.length) { setDepKindFilter(null); return; }
    setDepKindFilter(next);
  }

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-white/90 dark:bg-zinc-900/90 backdrop-blur border border-zinc-200 dark:border-zinc-800 rounded-md shadow-sm px-1 py-0.5"
      style={{ pointerEvents: 'auto', zIndex: 1000, isolation: 'isolate' }}
    >
      {/* Shape tools moved to the sidebar "Add new" palette (Epic 13) — one home for everything
          you can place on the canvas. The "drag to draw" hint still shows below when armed. */}
      <div className="relative" ref={layoutMenuRef}>
        <Btn onClick={() => setLayoutMenuOpen((v) => !v)} title="Auto-arrange">
          <span className="flex items-center gap-1">
            <Wand2 className="w-3.5 h-3.5" />
            <ChevronDown className="w-3 h-3" />
          </span>
        </Btn>
        {layoutMenuOpen && (
          <div
            className="absolute left-0 top-full mt-1 w-64 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden z-popover"
          >
            {/* Architectural by-type — top entry because it's view-aware: it picks the
                skeleton that fits the diagram you're on (C4, context map, layered deps). */}
            <button
              onClick={() => { onAutoLayout('byType'); setLayoutMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-start gap-2"
            >
              <LayoutDashboard className="w-3.5 h-3.5 mt-0.5 text-amber-500" />
              <div>
                <div className="font-medium">Architectural (by type) — recommended</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {isDepView
                    ? 'Apps on top, infrastructure on the bottom. Topological layers, BC clusters, crossings minimised.'
                    : 'Bounded Contexts as columns, modules stacked under their BC. Crossings minimised.'}
                </div>
              </div>
            </button>
            <button
              onClick={() => { onAutoLayout('hierarchical'); setLayoutMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-start gap-2 border-t border-zinc-200 dark:border-zinc-800"
            >
              <Wand2 className="w-3.5 h-3.5 mt-0.5 text-indigo-500" />
              <div>
                <div className="font-medium">Hierarchical (layered)</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Group by Bounded Context, top-down rows.</div>
              </div>
            </button>
            <button
              onClick={() => { onAutoLayout('force'); setLayoutMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 flex items-start gap-2 border-t border-zinc-200 dark:border-zinc-800"
            >
              <Network className="w-3.5 h-3.5 mt-0.5 text-violet-500" />
              <div>
                <div className="font-medium">Force-directed (organic)</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Spring + repulsion physics, clusters by links.</div>
              </div>
            </button>
            {/* Focus-around-selection. Gated to single-selection so the algorithm has an
                unambiguous focus point. Disabled rather than hidden when no/multi selection so
                architects discover the option and learn the gesture. */}
            <button
              onClick={() => { if (selectedCount === 1) { onAutoLayout('focused'); setLayoutMenuOpen(false); } }}
              disabled={selectedCount !== 1}
              title={selectedCount === 1
                ? 'Place the selected element at centre with neighbours in concentric rings'
                : 'Select exactly one element to use this layout'}
              className={clsx(
                'w-full text-left px-3 py-2 text-xs flex items-start gap-2 border-t border-zinc-200 dark:border-zinc-800',
                selectedCount === 1
                  ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                  : 'opacity-50 cursor-not-allowed'
              )}
            >
              <Target className="w-3.5 h-3.5 mt-0.5 text-rose-500" />
              <div>
                <div className="font-medium">Focus around selection</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  {selectedCount === 1
                    ? 'Selected element at centre, dependencies in concentric rings.'
                    : 'Select one element first.'}
                </div>
              </div>
            </button>
          </div>
        )}
      </div>
      <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <Btn onClick={toggleSnap} title="Snap to grid (20px)" active={snap}>
        <Magnet className="w-3.5 h-3.5" />
      </Btn>
      {hasSelection && (
        <Btn onClick={onFitSelection} title="Fit to selection (f)">
          <Maximize2 className="w-3.5 h-3.5" />
        </Btn>
      )}

      {/* Dependency-view-only block. Lives in the same bar as auto-arrange / snap so the architect
          has a single command surface. Hidden on every other view. */}
      {isDepView && (
        <>
          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <Btn
            onClick={() => setDepFocusMode(!depFocusMode)}
            title={depFocusMode ? 'Disable focus mode' : 'Focus mode — highlight selected node + dependencies'}
            active={depFocusMode}
          >
            <Crosshair className="w-3.5 h-3.5" />
          </Btn>
          {depFocusMode && (
            <>
              <span className="text-[10px] text-faint px-1">depth</span>
              {[1, 2, 3].map((n) => (
                <Btn key={n} onClick={() => setDepDepth(n)} title={`Show dependencies up to ${n} hop${n === 1 ? '' : 's'}`} active={depDepth === n}>
                  <span className="text-[11px] font-mono px-1">{n}</span>
                </Btn>
              ))}
            </>
          )}
          <div className="relative" ref={filterMenuRef}>
            <Btn
              onClick={() => setFilterOpen((v) => !v)}
              title={allKindsActive ? 'Filter dependency kinds' : `${visibleKindCount} of ${depKinds.length} kinds shown`}
              active={!allKindsActive}
            >
              <span className="flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" />
                {!allKindsActive && (
                  <span className="text-[10px] font-mono">{visibleKindCount}/{depKinds.length}</span>
                )}
                <ChevronDown className={clsx('w-3 h-3 transition-transform', filterOpen && 'rotate-180')} />
              </span>
            </Btn>
            {filterOpen && (
              <div
                className="absolute left-0 top-full mt-1 w-56 rounded border border-default surface-overlay shadow-lg overflow-hidden z-popover"
              >
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-faint border-b border-subtle flex items-center gap-2">
                  Dependency kinds
                  {!allKindsActive && (
                    <button onClick={() => setDepKindFilter(null)} className="ml-auto text-[10px] text-indigo-500 hover:text-indigo-700 underline">
                      reset
                    </button>
                  )}
                </div>
                {depKinds.length === 0 && (
                  <div className="px-3 py-3 text-[11px] text-faint italic">No dependencies in model.</div>
                )}
                {depKinds.map((k) => {
                  const active = allKindsActive || (depKindFilter as Set<string>).has(k);
                  return (
                    <button
                      key={k}
                      onClick={() => toggleKind(k)}
                      className={clsx(
                        'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors',
                        active
                          ? 'text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                          : 'text-faint line-through hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                      )}
                    >
                      <span className={clsx(
                        'w-3 h-3 rounded-sm border flex items-center justify-center text-[9px]',
                        active ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600' : 'border-default text-faint'
                      )}>
                        {active ? '✓' : ''}
                      </span>
                      <span className="font-mono">{k}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Alignment + distribute sections appear only when ≥2 / ≥3 nodes are selected.
          Disabled-but-shown looked noisy on every render; hide-when-not-applicable is calmer. */}
      {canAlign && (
        <>
          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <Btn onClick={() => onAlign('left')} title="Align left">
            <AlignLeft className="w-3.5 h-3.5" />
          </Btn>
          <Btn onClick={() => onAlign('centerX')} title="Align center (X)">
            <AlignCenterHorizontal className="w-3.5 h-3.5" />
          </Btn>
          <Btn onClick={() => onAlign('right')} title="Align right">
            <AlignRight className="w-3.5 h-3.5" />
          </Btn>
          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <Btn onClick={() => onAlign('top')} title="Align top">
            <AlignStartVertical className="w-3.5 h-3.5" />
          </Btn>
          <Btn onClick={() => onAlign('centerY')} title="Align center (Y)">
            <AlignCenterVertical className="w-3.5 h-3.5" />
          </Btn>
          <Btn onClick={() => onAlign('bottom')} title="Align bottom">
            <AlignEndVertical className="w-3.5 h-3.5" />
          </Btn>
        </>
      )}
      {canDistribute && (
        <>
          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <Btn onClick={() => onDistribute('horizontal')} title="Distribute horizontally">
            <StretchHorizontal className="w-3.5 h-3.5" />
          </Btn>
          <Btn onClick={() => onDistribute('vertical')} title="Distribute vertically">
            <StretchVertical className="w-3.5 h-3.5" />
          </Btn>
        </>
      )}
      {hasSelection && (
        <>
          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <span
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 font-medium"
            title="Shift+drag to marquee, Ctrl/Cmd+click to add"
          >
            <MousePointerSquareDashed className="w-3 h-3" />
            {selectedCount} selected
          </span>
          <Btn
            onClick={onDeleteSelected}
            title={selectedCount === 1 ? 'Delete selected' : `Delete ${selectedCount} selected`}
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
          </Btn>
        </>
      )}
      {inShapeMode && !hasSelection && (
        <>
          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <span className="text-[11px] text-faint px-2 italic">
            Drag on the canvas to draw {canvasMode.kind === 'shape' ? canvasMode.tool : ''}
          </span>
        </>
      )}
    </div>
  );
}
