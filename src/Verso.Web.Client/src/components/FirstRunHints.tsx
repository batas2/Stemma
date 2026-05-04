import { useEffect } from 'react';
import { useApp } from '@/lib/store';

const STORAGE_KEY = 'verso.firstrun.hints';

interface SeenMap {
  rightClick?: boolean;
  shiftDoubleClick?: boolean;
  paletteDrag?: boolean;
}

function read(): SeenMap {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); }
  catch { return {}; }
}

function mark(key: keyof SeenMap) {
  const seen = read();
  if (seen[key]) return;
  seen[key] = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
}

// Mounted once at app root. Listens for the first time a workspace is opened
// and surfaces a sequence of transient hints via the toast channel.
export function FirstRunHints() {
  const arch = useApp((s) => s.arch);
  const setToast = useApp((s) => s.setToast);

  useEffect(() => {
    if (!arch) return;
    const seen = read();
    const queue: { key: keyof SeenMap; text: string; delay: number }[] = [];
    if (!seen.rightClick) queue.push({ key: 'rightClick', text: 'Tip: right-click a node for quick actions.', delay: 1000 });
    if (!seen.paletteDrag) queue.push({ key: 'paletteDrag', text: 'Tip: drag from the sidebar palette onto the canvas to add elements.', delay: 4000 });
    if (!seen.shiftDoubleClick) queue.push({ key: 'shiftDoubleClick', text: 'Tip: shift+double-click an edge to add a waypoint.', delay: 7000 });
    const timeouts: number[] = [];
    for (const q of queue) {
      timeouts.push(window.setTimeout(() => {
        setToast({ kind: 'info', text: q.text });
        mark(q.key);
      }, q.delay));
    }
    return () => { for (const t of timeouts) window.clearTimeout(t); };
  }, [arch?.filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
