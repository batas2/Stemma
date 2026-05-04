import { useEffect, useState } from 'react';
import { Search, FolderOpen, Sparkles, Sun, Moon, Undo2, Redo2, ChevronDown, Clock } from 'lucide-react';
import { VersoLockup } from './Logo';
import { useApp } from '@/lib/store';
import { initWorkspace, openWorkspace, listRecents } from '@/lib/api';
import { fetchUndoState, undoOperation, redoOperation, type UndoState } from '@/lib/signalr';
import { format, primaryKeyLabel, shiftKeyLabel } from '@/lib/shortcuts';
import type { RecentEntry } from '@/lib/types';
import { ViewSwitcher } from './ViewSwitcher';
import { ExportMenu } from './ExportMenu';

export function Topbar() {
  const ws = useApp((s) => s.workspace);
  const setWs = useApp((s) => s.setWorkspace);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const setLoading = useApp((s) => s.setLoading);
  const setToast = useApp((s) => s.setToast);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const [pathInput, setPathInput] = useState('');
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [recentsOpen, setRecentsOpen] = useState(false);
  const [undoState, setUndoState] = useState<UndoState>({ canUndo: false, canRedo: false, undoDescription: null, redoDescription: null });

  useEffect(() => { listRecents().then(setRecents).catch(() => {}); }, [ws?.rootPath]);

  useEffect(() => {
    if (!ws) return;
    let stop = false;
    async function poll() {
      try { const s = await fetchUndoState(); if (!stop) setUndoState(s); } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 1500);
    return () => { stop = true; clearInterval(id); };
  }, [ws?.rootPath]);

  async function openPath(path: string) {
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

  async function handleUndo() {
    const r = await undoOperation();
    if (r && 'reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
  }

  async function handleRedo() {
    const r = await redoOperation();
    if (r && 'reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
  }

  return (
    <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-zinc-950/85 backdrop-blur flex items-center px-4 gap-3">
      <a href="/" className="flex items-center pr-3 mr-1 border-r border-zinc-200 dark:border-zinc-800 hover:opacity-90 transition-opacity">
        <VersoLockup size={22} showTagline={true} className="hidden sm:flex" />
        <VersoLockup size={22} showTagline={false} className="sm:hidden" />
      </a>
      <div className="flex-1 flex justify-center items-center gap-3">
        {ws ? (
          <>
            <ViewSwitcher />
            <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md p-0.5">
              <button
                onClick={handleUndo}
                disabled={!undoState.canUndo}
                title={undoState.undoDescription ? `Undo: ${undoState.undoDescription} (${format({ key: 'z', primary: true, description: '', handler: () => {} })})` : `Undo (${format({ key: 'z', primary: true, description: '', handler: () => {} })})`}
                className="p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRedo}
                disabled={!undoState.canRedo}
                title={undoState.redoDescription ? `Redo: ${undoState.redoDescription} (${primaryKeyLabel}${shiftKeyLabel}Z)` : `Redo (${primaryKeyLabel}${shiftKeyLabel}Z)`}
                className="p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200/70 dark:bg-zinc-900 dark:hover:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors w-44"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="text-[10px] font-mono bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{primaryKeyLabel}K</kbd>
            </button>
            <ExportMenu />
          </>
        ) : (
          <div className="flex items-center gap-2 w-[640px]">
            <FolderOpen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') openPath(pathInput.trim()); }}
              placeholder="/absolute/path/to/your/workspace"
              className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded px-3 py-1.5 text-xs outline-none focus:border-indigo-500 dark:focus:border-indigo-500"
            />
            <div className="relative">
              <button
                onClick={() => setRecentsOpen((v) => !v)}
                title="Recent workspaces"
                className="text-xs px-2.5 py-1.5 rounded bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 flex items-center gap-1"
              >
                <Clock className="w-3 h-3" /> Recent <ChevronDown className="w-3 h-3" />
              </button>
              {recentsOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-80 max-h-80 overflow-auto rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg z-50"
                  onMouseLeave={() => setRecentsOpen(false)}
                >
                  {recents.length === 0 && <div className="px-3 py-3 text-xs text-zinc-500">No recent workspaces yet.</div>}
                  {recents.map((r) => (
                    <button
                      key={r.rootPath}
                      onClick={() => { setRecentsOpen(false); openPath(r.rootPath); }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
                    >
                      <div className="font-medium truncate">{r.displayName}</div>
                      <div className="text-[10px] text-zinc-500 font-mono truncate">{r.rootPath}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => openPath(pathInput.trim())}
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
