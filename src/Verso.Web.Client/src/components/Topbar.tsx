import { useState } from 'react';
import { Search, FolderOpen, Box, Sparkles, Sun, Moon } from 'lucide-react';
import { useApp } from '@/lib/store';
import { initWorkspace, openWorkspace } from '@/lib/api';
import { ViewSwitcher } from './ViewSwitcher';

export function Topbar() {
  const ws = useApp((s) => s.workspace);
  const setWs = useApp((s) => s.setWorkspace);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const setLoading = useApp((s) => s.setLoading);
  const setToast = useApp((s) => s.setToast);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
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
    <header className="h-12 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur flex items-center px-4 gap-3">
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
        <span className="font-semibold tracking-tight">Verso</span>
        <span className="text-[10px] tracking-wider text-zinc-500 italic hidden sm:inline">the living architecture model</span>
      </div>
      <div className="flex-1 flex justify-center items-center gap-3">
        {ws ? (
          <>
            <ViewSwitcher />
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200/70 dark:bg-zinc-900 dark:hover:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors w-64"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">Search or run command…</span>
              <kbd className="text-[10px] font-mono bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">⌘K</kbd>
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 w-[640px]">
            <FolderOpen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(); }}
              placeholder="/absolute/path/to/your/workspace"
              className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded px-3 py-1.5 text-xs outline-none focus:border-indigo-500 dark:focus:border-indigo-500"
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
              className="text-xs px-3 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" />
              Create
            </button>
          </div>
        )}
      </div>
      <button
        onClick={toggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
      </button>
      <div className="text-[11px] text-zinc-500 truncate max-w-xs hidden md:block">
        {ws ? <span className="font-mono">{ws.rootPath.split('/').slice(-2).join('/')}</span> : null}
      </div>
    </header>
  );
}
