import { useEffect, useState } from 'react';
import { useApp } from '@/lib/store';
import { getConnectionState } from '@/lib/signalr';

export function StatusBar() {
  const ws = useApp((s) => s.workspace);
  const toast = useApp((s) => s.toast);
  const setToast = useApp((s) => s.setToast);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast, setToast]);

  const conn = getConnectionState();
  const totalTypes = ws?.projects.reduce((s, p) => s + p.types.length, 0) ?? 0;

  return (
    <footer className="h-7 border-t border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur px-3 flex items-center text-[11px] text-zinc-500 dark:text-zinc-500 gap-4">
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${conn === 'Connected' ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'}`} />
        {conn}
      </span>
      {ws && (
        <>
          <span>{ws.projects.length} project{ws.projects.length === 1 ? '' : 's'}</span>
          <span>{totalTypes} type{totalTypes === 1 ? '' : 's'}</span>
        </>
      )}
      <span className="ml-auto">
        {toast && (
          <span
            className={
              toast.kind === 'error' ? 'text-rose-600 dark:text-rose-400' :
              toast.kind === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
              'text-zinc-700 dark:text-zinc-300'
            }
          >
            {toast.text}
          </span>
        )}
      </span>
      <span className="opacity-0">{tick}</span>
    </footer>
  );
}
