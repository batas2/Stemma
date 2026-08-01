import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { getConnectionState } from '@/lib/signalr';

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
