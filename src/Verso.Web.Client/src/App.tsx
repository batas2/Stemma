import { useEffect } from 'react';
import { Topbar } from './components/Topbar';
import { Canvas } from './components/Canvas';
import { ArchCanvas } from './components/ArchCanvas';
import { Inspector } from './components/Inspector';
import { ArchInspector } from './components/ArchInspector';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { EmptyState } from './components/EmptyState';
import { useApp } from './lib/store';
import { ensureConnection, onOperationApplied } from './lib/signalr';
import { archModel, snapshot } from './lib/api';

export default function App() {
  const ws = useApp((s) => s.workspace);
  const arch = useApp((s) => s.arch);
  const view = useApp((s) => s.view);
  const setWs = useApp((s) => s.setWorkspace);
  const setArch = useApp((s) => s.setArch);
  const setView = useApp((s) => s.setView);

  useEffect(() => {
    ensureConnection().catch(() => {});
    snapshot().then((s) => { if (s) setWs(s); }).catch(() => {});
    archModel().then((a) => setArch(a)).catch(() => setArch(null));
    const off = onOperationApplied(async () => {
      const [s, a] = await Promise.all([snapshot(), archModel().catch(() => null)]);
      if (s) setWs(s);
      setArch(a);
    });
    return () => { off(); };
  }, [setWs, setArch]);

  // Auto-pick a sensible default view based on workspace contents.
  useEffect(() => {
    if (!ws) return;
    if (arch && view === 'engineer') setView('moduleMap');
    else if (!arch && view !== 'engineer') setView('engineer');
  }, [ws, arch, view, setView]);

  return (
    <div className="h-screen flex flex-col">
      <Topbar />
      <div className="flex-1 flex min-h-0">
        {ws ? (
          <>
            <main className="flex-1 min-w-0">
              {view === 'engineer' ? <Canvas /> : <ArchCanvas />}
            </main>
            {view === 'engineer' ? <Inspector /> : <ArchInspector />}
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
