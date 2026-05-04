import { useState } from 'react';
import { Plus, FileText, Edit3, Lightbulb } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { fetchDecisionNarrative } from '@/lib/api';
import { MarkdownEditor } from './MarkdownEditor';
import type { ArchDecisionInfo } from '@/lib/types';

const STATUSES = ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'];
const STATUS_COLORS: Record<string, string> = {
  proposed: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  accepted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  superseded: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
  deprecated: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

export function DecisionLog() {
  const arch = useApp((s) => s.arch);
  const setToast = useApp((s) => s.setToast);
  const [openId, setOpenId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const decisions = arch?.decisions ?? [];

  async function handleAdd() {
    const title = prompt('Decision title')?.trim();
    if (!title) return;
    const r = await applyOperation({ kind: 'AddDecision', opId: `op_${Date.now()}`, title });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: `Added "${title}"` });
  }

  async function handleStatusChange(d: ArchDecisionInfo, status: string) {
    const r = await applyOperation({
      kind: 'SetDecisionStatus', opId: `op_${Date.now()}`, decisionId: d.id, status,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
  }

  async function openNarrative(id: string) {
    setOpenId(id);
    const md = await fetchDecisionNarrative(id);
    setBody(md);
  }

  async function saveNarrative() {
    if (!openId) return;
    const r = await applyOperation({
      kind: 'SetDecisionNarrative', opId: `op_${Date.now()}`, decisionId: openId, body,
    });
    if ('reason' in r) setToast({ kind: 'error', text: `${r.reason}: ${r.message}` });
    else setToast({ kind: 'success', text: 'Saved' });
  }

  return (
    <div className="h-full w-full flex bg-zinc-50 dark:bg-zinc-950">
      <div className="flex-1 overflow-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <h1 className="text-lg font-semibold">Decision Log</h1>
            <span className="text-xs text-zinc-500">({decisions.length})</span>
            <button
              onClick={handleAdd}
              className="ml-auto flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white"
            >
              <Plus className="w-3 h-3" /> New decision
            </button>
          </div>
          {decisions.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-700 mb-2" />
              <p className="text-sm text-zinc-500">No decisions yet.</p>
              <p className="text-xs text-zinc-400 mt-1">Click "New decision" above to record one.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {decisions.map((d) => (
                <li
                  key={d.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => openNarrative(d.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={clsx(
                          'text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium',
                          STATUS_COLORS[d.status] ?? 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30'
                        )}>{d.status}</span>
                        {d.date && <span className="text-[11px] text-zinc-500 font-mono">{d.date}</span>}
                        <span className="text-[10px] text-zinc-400 font-mono ml-auto">{d.id}</span>
                      </div>
                      <h3 className="text-sm font-medium mt-1 text-zinc-900 dark:text-zinc-100">{d.title}</h3>
                    </div>
                    <Edit3 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {openId && (
        <aside className="w-[480px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
            <h2 className="text-sm font-semibold flex-1 truncate">
              {decisions.find((d) => d.id === openId)?.title}
            </h2>
            <select
              value={decisions.find((d) => d.id === openId)?.status ?? 'proposed'}
              onChange={(ev) => {
                const d = decisions.find((x) => x.id === openId);
                if (d) handleStatusChange(d, ev.target.value);
              }}
              className="text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => setOpenId(null)}
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <MarkdownEditor value={body} onChange={setBody} />
          </div>
          <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
            <button
              onClick={saveNarrative}
              className="flex-1 text-xs px-3 py-1.5 rounded bg-indigo-500 hover:bg-indigo-400 text-white"
            >
              Save narrative
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
