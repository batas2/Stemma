import { useEffect, useState } from 'react';
import { Sparkles, FolderOpen, Clock, FileCode, Lightbulb, Layers } from 'lucide-react';
import { StemmaMark } from './Logo';
import { useApp } from '@/lib/store';
import { initWorkspace, openWorkspace, listRecents } from '@/lib/api';
import { promptText } from './PromptDialog';
import type { RecentEntry } from '@/lib/types';

/**
 * The first screen. Two doors — start a new model, or open one that exists — plus recents. Neither
 * door requires knowing or typing a filesystem path: a new model is created by name.
 */
export function EmptyState() {
  const setWs = useApp((s) => s.setWorkspace);
  const setLoading = useApp((s) => s.setLoading);
  const setToast = useApp((s) => s.setToast);
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  useEffect(() => { listRecents().then(setRecents).catch(() => {}); }, []);

  async function createModel() {
    const name = await promptText({
      title: 'New model',
      body: 'Stemma will create it in your home folder and start a Git repository for it.',
      placeholder: 'Payments Platform',
      confirmLabel: 'Create',
      validate: (v) => (v.trim().length === 0 ? 'Give the model a name' : null),
    });
    if (!name) return;
    setLoading(true);
    try {
      const w = await initWorkspace(undefined, name.trim());
      setWs(w);
      setToast({ kind: 'success', text: `Created ${name.trim()} in ${w.rootPath}` });
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function openExisting() {
    const path = await promptText({
      title: 'Open a workspace',
      body: 'A folder containing an Architecture/ model, or a repository with a .sln or .csproj.',
      placeholder: '/home/you/code/your-service',
      confirmLabel: 'Open',
      validate: (v) => (v.trim().length === 0 ? 'Enter a folder path' : null),
    });
    if (!path) return;
    await open(path.trim());
  }

  async function open(path: string) {
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
    <div className="flex-1 flex items-center justify-center overflow-auto">
      <div className="max-w-xl px-6 py-12 w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-5">
            <StemmaMark size={56} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Stemma</h1>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 mb-5">the living architecture model</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-md mx-auto">
            A modelling tool for solution and data architects where the source code is the database.
            Decisions, capabilities, and stakeholder views live in compiling C# you can read, hand-edit,
            and audit in Git.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <button
            onClick={createModel}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-indigo-500 px-4 py-3 text-sm font-medium text-white transition-colors"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            Start a new model
          </button>
          <button
            onClick={openExisting}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-zinc-200
                       dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-indigo-500 px-4 py-3 text-sm font-medium transition-colors"
          >
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
            Open an existing one
          </button>
        </div>

        {recents.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
              <Clock className="w-3 h-3" aria-hidden="true" /> Recent
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              {recents.slice(0, 4).map((r) => (
                <button
                  key={r.rootPath}
                  onClick={() => open(r.rootPath)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60
                             border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
                >
                  <div className="font-medium truncate">{r.displayName}</div>
                  <div className="text-[10px] text-zinc-500 font-mono truncate">{r.rootPath}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Highlight icon={FileCode} title="Code as database" body="Everything is .cs and .md. No proprietary store." />
          <Highlight icon={Lightbulb} title="Decisions in source" body="ADRs, options, lifecycle — all checked in." />
          <Highlight icon={Layers} title="Layered & multi-audience" body="Navigate by layer — System, Data, Governance, Code — re-aimed per audience." />
        </div>
      </div>
    </div>
  );
}

function Highlight({ icon: Icon, title, body }: { icon: typeof Sparkles; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-3 text-left">
      <Icon className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 mb-1.5" />
      <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 mb-0.5">{title}</div>
      <div className="text-[11px] text-zinc-500 leading-snug">{body}</div>
    </div>
  );
}
