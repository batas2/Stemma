import { useMemo, useRef } from 'react';
import {
  Wand2, Network, LayoutDashboard, Target, Hand, Magnet, Maximize2, Trash2, Check, MousePointerSquareDashed,
  AlignLeft, AlignRight, AlignCenterHorizontal, AlignStartVertical, AlignEndVertical, AlignCenterVertical,
  StretchHorizontal, StretchVertical, RotateCcw, Crosshair,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import type { LayoutAlgorithm } from '@/lib/autoLayout';

/** Layout actions the panel asks the canvas to perform. The canvas (ArchCanvas) owns the node
 *  state + React Flow handle, so we decouple via a window event instead of prop-drilling. */
export type LayoutAction =
  | { type: 'auto'; algorithm: LayoutAlgorithm }
  | { type: 'align'; axis: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY' }
  | { type: 'distribute'; axis: 'horizontal' | 'vertical' }
  | { type: 'fit' }
  | { type: 'delete' };

export const LAYOUT_ACTION_EVENT = 'stemma:layout-action';

function send(a: LayoutAction) {
  window.dispatchEvent(new CustomEvent(LAYOUT_ACTION_EVENT, { detail: a }));
}

export function LayoutPanel() {
  const selectedCount = useApp((s) => s.canvasSelection);
  const snap = useApp((s) => s.snapEnabled);
  const toggleSnap = useApp((s) => s.toggleSnap);
  const view = useApp((s) => s.view);
  const force = useApp((s) => s.forceParams);
  const setForce = useApp((s) => s.setForceParams);
  const resetForce = useApp((s) => s.resetForceParams);
  const hier = useApp((s) => s.hierParams);
  const setHier = useApp((s) => s.setHierParams);
  const resetHier = useApp((s) => s.resetHierParams);
  const byType = useApp((s) => s.byTypeParams);
  const setByType = useApp((s) => s.setByTypeParams);
  const resetByType = useApp((s) => s.resetByTypeParams);

  // Per-view layout mode. The active view key mirrors ArchCanvas's layoutKey.
  const activeCustomViewId = useApp((s) => s.activeCustomViewId);
  const viewLayouts = useApp((s) => s.viewLayouts);
  const setViewLayout = useApp((s) => s.setViewLayout);
  const layoutKey = activeCustomViewId ? `custom:${activeCustomViewId}` : view;
  const mode = viewLayouts[layoutKey] ?? 'custom';

  // Picking an auto algorithm applies it immediately and makes it this view's mode; tweaking that
  // algorithm's settings re-applies it (debounced) so the canvas stays in sync.
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function applyLive(algo: LayoutAlgorithm) {
    if (applyTimer.current) clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => send({ type: 'auto', algorithm: algo }), 280);
  }
  function pick(algo: 'force' | 'hierarchical' | 'byType') {
    setViewLayout(layoutKey, algo);
    send({ type: 'auto', algorithm: algo });
  }

  const arch = useApp((s) => s.arch);
  const depFocusMode = useApp((s) => s.depFocusMode);
  const setDepFocusMode = useApp((s) => s.setDepFocusMode);
  const depKindFilter = useApp((s) => s.depKindFilter);
  const setDepKindFilter = useApp((s) => s.setDepKindFilter);
  const depDepth = useApp((s) => s.depDepth);
  const setDepDepth = useApp((s) => s.setDepDepth);

  const isDep = view === 'dependencyGraph';
  const canAlign = selectedCount >= 2;
  const canDistribute = selectedCount >= 3;

  const depKinds = useMemo(() => {
    if (!arch) return [];
    const set = new Set<string>();
    for (const l of arch.links) if (l.kind === 'dependency') set.add(l.attributes.kind ?? 'uses');
    return [...set].sort();
  }, [arch]);
  const allKinds = depKindFilter === null;
  function toggleKind(k: string) {
    if (allKinds) { setDepKindFilter(new Set(depKinds.filter((x) => x !== k))); return; }
    const next = new Set(depKindFilter as Set<string>);
    if (next.has(k)) next.delete(k); else next.add(k);
    setDepKindFilter(next.size === depKinds.length ? null : next);
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      <Group title="Align & distribute">
        <div className={clsx('text-[11px] mb-2 px-2 py-1.5 rounded-md flex items-center gap-1.5',
          selectedCount >= 2 ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'bg-zinc-100 dark:bg-zinc-800/50 text-faint')}>
          <MousePointerSquareDashed className="w-3.5 h-3.5 shrink-0" />
          {selectedCount === 0 ? 'Select 2+ elements — Shift-drag a box, or Ctrl-click several.'
            : selectedCount === 1 ? 'Pick at least one more element to align them.'
            : selectedCount === 2 ? '2 selected — align ready (select a 3rd to distribute).'
            : `${selectedCount} selected — align & distribute ready.`}
        </div>

        <SubLabel>Align edges — line elements up horizontally</SubLabel>
        <div className="grid grid-cols-3 gap-1.5">
          <BigBtn icon={<AlignLeft className="w-4 h-4" />} label="Left" disabled={!canAlign} onClick={() => send({ type: 'align', axis: 'left' })} />
          <BigBtn icon={<AlignCenterHorizontal className="w-4 h-4" />} label="Center" disabled={!canAlign} onClick={() => send({ type: 'align', axis: 'centerX' })} />
          <BigBtn icon={<AlignRight className="w-4 h-4" />} label="Right" disabled={!canAlign} onClick={() => send({ type: 'align', axis: 'right' })} />
        </div>

        <SubLabel>Align edges — line elements up vertically</SubLabel>
        <div className="grid grid-cols-3 gap-1.5">
          <BigBtn icon={<AlignStartVertical className="w-4 h-4" />} label="Top" disabled={!canAlign} onClick={() => send({ type: 'align', axis: 'top' })} />
          <BigBtn icon={<AlignCenterVertical className="w-4 h-4" />} label="Middle" disabled={!canAlign} onClick={() => send({ type: 'align', axis: 'centerY' })} />
          <BigBtn icon={<AlignEndVertical className="w-4 h-4" />} label="Bottom" disabled={!canAlign} onClick={() => send({ type: 'align', axis: 'bottom' })} />
        </div>

        <SubLabel>Distribute — equal gaps between 3+ elements</SubLabel>
        <div className="grid grid-cols-2 gap-1.5">
          <BigBtn icon={<StretchHorizontal className="w-4 h-4" />} label="Even columns" disabled={!canDistribute} onClick={() => send({ type: 'distribute', axis: 'horizontal' })} />
          <BigBtn icon={<StretchVertical className="w-4 h-4" />} label="Even rows" disabled={!canDistribute} onClick={() => send({ type: 'distribute', axis: 'vertical' })} />
        </div>

        <button
          onClick={() => send({ type: 'delete' })} disabled={selectedCount === 0}
          className={clsx('w-full mt-1 flex items-center justify-center gap-1.5 h-8 rounded-md border text-xs',
            selectedCount === 0 ? 'border-default text-faint cursor-not-allowed' : 'border-rose-300/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10')}
        >
          <Trash2 className="w-4 h-4" /> Delete selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
      </Group>

      <Group title="View layout">
        <p className="text-[10px] text-faint -mt-0.5 mb-1">Applies to this view and is remembered. Settings show for the active mode.</p>
        <Algo
          icon={<LayoutDashboard className="w-4 h-4 text-amber-500" />} title="Architectural (by type)" active={mode === 'byType'}
          desc={isDep ? 'Apps on top, infra on the bottom. Layers + BC clusters.' : 'Bounded Contexts as columns, modules stacked under them.'}
          onClick={() => pick('byType')}
        />
        <Algo
          icon={<Wand2 className="w-4 h-4 text-indigo-500" />} title="Hierarchical (layered)" active={mode === 'hierarchical'}
          desc="Group by Bounded Context, top-down rows." onClick={() => pick('hierarchical')}
        />
        <Algo
          icon={<Network className="w-4 h-4 text-violet-500" />} title="Force-directed (organic)" active={mode === 'force'}
          desc="Spring + repulsion physics, clusters by links." onClick={() => pick('force')}
        />
        <Algo
          icon={<Hand className="w-4 h-4 text-emerald-500" />} title="Custom (manual)" active={mode === 'custom'}
          desc="Your positions stay put — nothing auto-arranges this view." onClick={() => setViewLayout(layoutKey, 'custom')}
        />
        <Algo
          icon={<Target className="w-4 h-4 text-rose-500" />} title="Focus around selection"
          desc={selectedCount === 1 ? 'One-shot: centre the selected node, neighbours in rings.' : 'Select exactly one element first.'}
          disabled={selectedCount !== 1} onClick={() => { send({ type: 'auto', algorithm: 'focused' }); setViewLayout(layoutKey, 'custom'); }}
        />
      </Group>

      {mode === 'force' && (
        <Group title="Organic layout settings" trailing={<Reset onClick={resetForce} />}>
          <Slider label="Spread" value={force.spacing} min={0.5} max={2.5} step={0.1} fmt={(v) => `${v.toFixed(1)}×`} onChange={(v) => { setForce({ spacing: v }); applyLive('force'); }} />
          <Slider label="Gravity" value={force.gravity} min={0.01} max={0.2} step={0.005} fmt={(v) => v.toFixed(3)} onChange={(v) => { setForce({ gravity: v }); applyLive('force'); }} />
          <Slider label="Cluster pull" value={force.clusterPull} min={0} max={0.1} step={0.002} fmt={(v) => v.toFixed(3)} onChange={(v) => { setForce({ clusterPull: v }); applyLive('force'); }} />
          <Slider label="Iterations" value={force.iterations} min={80} max={600} step={20} fmt={(v) => String(Math.round(v))} onChange={(v) => { setForce({ iterations: Math.round(v) }); applyLive('force'); }} />
          <Apply label="Re-apply organic layout" onClick={() => send({ type: 'auto', algorithm: 'force' })} />
        </Group>
      )}

      {mode === 'hierarchical' && (
        <Group title="Hierarchical layout settings" trailing={<Reset onClick={resetHier} />}>
          <Slider label="Column gap" value={hier.colGap} min={120} max={520} step={10} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => { setHier({ colGap: v }); applyLive('hierarchical'); }} />
          <Slider label="Row gap" value={hier.rowGap} min={80} max={420} step={10} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => { setHier({ rowGap: v }); applyLive('hierarchical'); }} />
          <Apply label="Re-apply hierarchical layout" onClick={() => send({ type: 'auto', algorithm: 'hierarchical' })} />
        </Group>
      )}

      {mode === 'byType' && (
        <Group title="By-type layout settings" trailing={<Reset onClick={resetByType} />}>
          <Slider label="Node gap" value={byType.gap} min={10} max={160} step={5} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => { setByType({ gap: v }); applyLive('byType'); }} />
          <Slider label="Group gap" value={byType.groupGap} min={40} max={340} step={10} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => { setByType({ groupGap: v }); applyLive('byType'); }} />
          <Slider label="Row gap" value={byType.rowGap} min={60} max={420} step={10} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => { setByType({ rowGap: v }); applyLive('byType'); }} />
          <Apply label="Re-apply by-type layout" onClick={() => send({ type: 'auto', algorithm: 'byType' })} />
        </Group>
      )}

      {mode === 'custom' && (
        <p className="text-[11px] text-faint px-0.5">Custom layout — drag elements freely. Pick an algorithm above to auto-arrange; moving or adding an element switches back to Custom.</p>
      )}

      <Group title="Canvas">
        <button
          onClick={toggleSnap}
          className={clsx('w-full flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors',
            snap ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'border-default text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60')}
        >
          <Magnet className="w-4 h-4" /> Snap to grid (20px) <span className="ml-auto text-[10px] text-faint">{snap ? 'on' : 'off'}</span>
        </button>
        <button
          onClick={() => send({ type: 'fit' })} disabled={selectedCount === 0}
          className={clsx('w-full flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs',
            selectedCount === 0 ? 'border-default text-faint cursor-not-allowed' : 'border-default text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60')}
        >
          <Maximize2 className="w-4 h-4" /> Fit to selection
        </button>
      </Group>

      {isDep && (
        <Group title="Dependency view">
          <button
            onClick={() => setDepFocusMode(!depFocusMode)}
            className={clsx('w-full flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs',
              depFocusMode ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'border-default text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60')}
          >
            <Crosshair className="w-4 h-4" /> Focus mode <span className="ml-auto text-[10px] text-faint">{depFocusMode ? 'on' : 'off'}</span>
          </button>
          {depFocusMode && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-faint">depth</span>
              {[1, 2, 3].map((n) => (
                <Mini key={n} onClick={() => setDepDepth(n)} title={`${n} hop${n === 1 ? '' : 's'}`} active={depDepth === n}>
                  <span className="text-[11px] font-mono">{n}</span>
                </Mini>
              ))}
            </div>
          )}
          {depKinds.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-faint flex items-center">
                Dependency kinds
                {!allKinds && <button onClick={() => setDepKindFilter(null)} className="ml-auto text-[10px] text-indigo-500 hover:text-indigo-700 underline">reset</button>}
              </div>
              {depKinds.map((k) => {
                const active = allKinds || (depKindFilter as Set<string>).has(k);
                return (
                  <button key={k} onClick={() => toggleKind(k)} className={clsx('w-full text-left px-2 py-1 text-xs rounded flex items-center gap-2',
                    active ? 'text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60' : 'text-faint line-through hover:bg-zinc-100 dark:hover:bg-zinc-800/60')}>
                    <span className={clsx('w-3 h-3 rounded-sm border flex items-center justify-center text-[9px]', active ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600' : 'border-default')}>{active ? '✓' : ''}</span>
                    <span className="font-mono">{k}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Group>
      )}
    </div>
  );
}

function Reset({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700">
      <RotateCcw className="w-3 h-3" /> Reset
    </button>
  );
}

function Apply({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full mt-1 px-2 py-1.5 rounded-md bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600">
      {label}
    </button>
  );
}

function Group({ title, trailing, children }: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center mb-1.5">
        <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{title}</h4>
        {trailing && <span className="ml-auto">{trailing}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Algo({ icon, title, desc, onClick, disabled, active }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className={clsx('w-full text-left px-2.5 py-2 rounded-md border flex items-start gap-2 transition-colors',
        disabled ? 'border-default opacity-50 cursor-not-allowed'
          : active ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30'
            : 'border-default hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10')}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-xs font-medium text-body">
          {title}
          {active && <Check className="w-3 h-3 text-indigo-500 ml-auto shrink-0" />}
        </span>
        <span className="block text-[10px] text-faint mt-0.5 leading-snug">{desc}</span>
      </span>
    </button>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-faint">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-indigo-500" />
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-faint mt-2 mb-1 first:mt-0">{children}</div>;
}

/** Icon-over-label button — makes Align/Distribute actions self-explanatory at a glance. */
function BigBtn({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={label}
      className={clsx('flex flex-col items-center justify-center gap-1 py-2 rounded-md border transition-colors',
        disabled ? 'border-default text-zinc-300 dark:text-zinc-700 cursor-not-allowed'
          : 'border-default text-body hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10')}
    >
      {icon}
      <span className="text-[10px] leading-none font-medium">{label}</span>
    </button>
  );
}

function Mini({ onClick, title, active, disabled, children }: { onClick: () => void; title: string; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      className={clsx('flex items-center justify-center h-8 rounded-md border transition-colors',
        disabled ? 'border-default text-zinc-300 dark:text-zinc-700 cursor-not-allowed'
          : active ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
            : 'border-default text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/60')}>
      {children}
    </button>
  );
}
