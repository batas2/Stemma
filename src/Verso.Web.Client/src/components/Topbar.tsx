import { useState } from 'react';
import { Search, FolderOpen, Box } from 'lucide-react';
import { useApp } from '@/lib/store';
import { openWorkspace } from '@/lib/api';

export function Topbar() {
  const ws = useApp((s) => s.workspace);
  const setWs = useApp((s) => s.setWorkspace);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const setLoading = useApp((s) => s.setLoading);
  const setToast = useApp((s) => s.setToast);
  const [pathInput, setPathInput] = useState('');

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

  return (
    <header className="h-12 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur flex items-center px-4 gap-3">
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-indigo-400" />
        <span className="font-semibold tracking-tight">Verso</span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800/60">spike</span>
      </div>
      <div className="flex-1 flex justify-center">
        {ws ? (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors w-80"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">Search or run command…</span>
            <kbd className="text-[10px] font-mono bg-zinc-800 px-1.5 py-0.5 rounded">⌘K</kbd>
          </button>
        ) : (
          <div className="flex items-center gap-2 w-[480px]">
            <FolderOpen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(); }}
              placeholder="/absolute/path/to/your/solution-or-folder"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleOpen}
              className="text-xs px-3 py-1.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white"
            >
              Open
            </button>
          </div>
        )}
      </div>
      <div className="text-[11px] text-zinc-500 truncate max-w-xs">
        {ws ? <span className="font-mono">{ws.rootPath}</span> : null}
      </div>
    </header>
  );
}
