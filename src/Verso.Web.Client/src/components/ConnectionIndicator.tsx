import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { getConnectionState } from '@/lib/signalr';

/** Prominent red box, fixed top-right, shown only while the backend connection is down for
 *  more than a moment (so the initial handshake doesn't flash it). */
export function ConnectionIndicator() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let stop = false;
    let downSince: number | null = null;
    function tick() {
      if (stop) return;
      const s = getConnectionState();
      const ok = s === 'Connected' || s === 'unknown';
      if (ok) { downSince = null; setDown(false); return; }
      if (downSince === null) downSince = Date.now();
      setDown(Date.now() - downSince > 1500);
    }
    tick();
    const id = setInterval(tick, 500);
    return () => { stop = true; clearInterval(id); };
  }, []);

  if (!down) return null;
  return (
    <div
      role="alert"
      className="fixed top-3 right-3 z-50 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold shadow-lg ring-2 ring-rose-300/60 animate-pulse"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      Disconnected from backend — reconnecting…
    </div>
  );
}
