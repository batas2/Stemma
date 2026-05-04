import { useEffect } from 'react';
import { Topbar } from './components/Topbar';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { EmptyState } from './components/EmptyState';
import { useApp } from './lib/store';
import { ensureConnection, onOperationApplied } from './lib/signalr';
import { snapshot } from './lib/api';

export default function App() {
  const ws = useApp((s) => s.workspace);
  const setWs = useApp((s) => s.setWorkspace);

  useEffect(() => {
    ensureConnection().catch(() => {/* surfaced in StatusBar */});
    snapshot().then((s) => { if (s) setWs(s); }).catch(() => {/* ignore */});
    const off = onOperationApplied(async () => {
      const s = await snapshot();
      if (s) setWs(s);
    });
    return () => { off(); };
  }, [setWs]);

  return (
    <div className="h-screen flex flex-col">
      <Topbar />
      <div className="flex-1 flex min-h-0">
        {ws ? (
          <>
            <main className="flex-1 min-w-0">
              <Canvas />
            </main>
            <Inspector />
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
