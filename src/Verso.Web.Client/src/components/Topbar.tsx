import { useState } from 'react';
import { Search, FolderOpen, Box, Sparkles } from 'lucide-react';
import { useApp } from '@/lib/store';
import { initWorkspace, openWorkspace } from '@/lib/api';
import { ViewSwitcher } from './ViewSwitcher';

export function Topbar() {
  const ws = useApp((s) => s.workspace);
  const setWs = useApp((s) => s.setWorkspace);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const setLoading = useApp((s) => s.setLoading);
  const setToast = useApp((s) => s.setToast);
  const [pathInput, setPathInput] = useState('');
  const [showInit, setShowInit] = useState(false);

  async function handleOpen() {
    const path = pathInput.trim();
    if (!path) return;
    setLoading(true);
    try {
      const w = await openWorkspace(path);
      setWs(w);
      setToast({ kind: 'success', text: `Opened ${path}` });
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function handleInit() {
    const path = pathInput.trim();
    if (!path) return;
    setLoading(true);
    try {
      const w = await initWorkspace(path);
      setWs(w);
      setToast({ kind: 'success', text: `Created and opened ${path}` });
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <header className="h-12 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur flex items-center px-4 gap-3">
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-indigo-400" />
        <span className="font-semibold tracking-tight">Verso</span>
        <span className="text-[10px] tracking-wider text-zinc-500 italic hidden sm:inline">the living architecture model</span>
      </div>
      <div className="flex-1 flex justify-center items-center gap-3">
        {ws ? (
          <>
            <ViewSwitcher />
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors w-64"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">Search or run command…</span>
              <kbd className="text-[10px] font-mono bg-zinc-800 px-1.5 py-0.5 rounded">⌘K</kbd>
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 w-[640px]">
            <FolderOpen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (showInit ? handleInit : handleOpen)(); }}
              placeholder="/absolute/path/to/your/workspace"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleOpen}
              className="text-xs px-3 py-1.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white"
            >
              Open
            </button>
            <button
              onClick={handleInit}
              title="Scaffold a new model workspace at this path"
              className="text-xs px-3 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 flex items-center gap-1"
              onMouseEnter={() => setShowInit(true)}
              onMouseLeave={() => setShowInit(false)}
            >
              <Sparkles className="w-3 h-3" />
              Create
            </button>
          </div>
        )}
      </div>
      <div className="text-[11px] text-zinc-500 truncate max-w-xs">
        {ws ? <span className="font-mono">{ws.rootPath.split('/').slice(-2).join('/')}</span> : null}
      </div>
    </header>
  );
}
