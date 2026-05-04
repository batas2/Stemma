import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';

interface QueueItem {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

const MAX = 3;
const AUTO_DISMISS_MS = 4000;

export function ToastQueue() {
  const incoming = useApp((s) => s.toast);
  const setToast = useApp((s) => s.setToast);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  useEffect(() => {
    if (!incoming) return;
    const id = Date.now() + Math.random();
    const item: QueueItem = { id, kind: incoming.kind, text: incoming.text };
    setQueue((q) => [...q, item].slice(-MAX));
    setToast(null);
    const t = window.setTimeout(() => {
      setQueue((q) => q.filter((x) => x.id !== id));
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [incoming, setToast]);

  function dismiss(id: number) {
    setQueue((q) => q.filter((x) => x.id !== id));
  }

  if (queue.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-10 right-4 z-toast flex flex-col gap-2 pointer-events-none"
    >
      {queue.map((t) => {
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertCircle : Info;
        const tone =
          t.kind === 'success' ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' :
          t.kind === 'error' ? 'border-rose-500/40 text-rose-700 dark:text-rose-300' :
          'border-indigo-500/40 text-indigo-700 dark:text-indigo-300';
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={clsx(
              'pointer-events-auto surface-overlay rounded shadow-lg px-3 py-2 flex items-center gap-2 text-xs min-w-[260px] max-w-md text-left border-l-4',
              tone
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-body">{t.text}</span>
            <X className="w-3 h-3 text-faint" aria-label="Dismiss" />
          </button>
        );
      })}
    </div>
  );
}
