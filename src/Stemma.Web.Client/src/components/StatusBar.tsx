import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { getConnectionState } from '@/lib/signalr';
import { startCompare, useUncommittedDiff } from '@/lib/compare';
import { describeCounts } from '@/lib/modelDiff';

export function StatusBar() {
  const ws = useApp((s) => s.workspace);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const conn = getConnectionState();
  const totalTypes = ws?.projects.reduce((s, p) => s + p.types.length, 0) ?? 0;

  return (
    <footer role="contentinfo" className="h-7 border-t border-default bg-white/80 dark:bg-zinc-950/80 backdrop-blur px-3 flex items-center text-[11px] text-faint gap-4">
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${conn === 'Connected' ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
        {conn}
      </span>
      {ws && (
        <>
          <span>{ws.projects.length} project{ws.projects.length === 1 ? '' : 's'}</span>
          <span>{totalTypes} type{totalTypes === 1 ? '' : 's'}</span>
          <ActiveViewBadge />
          <UncommittedChanges />
        </>
      )}
      <span className="opacity-0 ml-auto">{tick}</span>
    </footer>
  );
}

function ActiveViewBadge() {
  const customViews = useApp((s) => s.customViews);
  const activeId = useApp((s) => s.activeCustomViewId);
  const active = customViews.find((v) => v.id === activeId);
  if (!active) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-indigo-600 dark:text-indigo-400">view: {active.name} ({active.elementIds.length})</span>
    </span>
  );
}

/**
 * How much the model has changed since the last commit (F-017 AC6) — the running answer to "what have
 * I done to the repository?" — and one click to see it drawn.
 */
function UncommittedChanges() {
  const diff = useUncommittedDiff();
  const comparing = useApp((s) => s.compare?.rev === 'HEAD');
  if (!diff || diff.counts.total === 0) return null;
  const n = diff.counts.total;
  return (
    <button
      onClick={() => { void startCompare('HEAD', 'the last commit'); }}
      disabled={comparing}
      title={`${describeCounts(diff.counts)} since the last commit — click to see them on the canvas`}
      className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 hover:underline disabled:no-underline disabled:opacity-70"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
      {n} change{n === 1 ? '' : 's'} since the last commit
    </button>
  );
}
