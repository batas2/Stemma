import { useState } from 'react';
import { Plus, FileText, Edit3, Lightbulb } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { fetchDecisionNarrative } from '@/lib/api';
import { NotesModal } from './NotesModal';
import { promptText } from './PromptDialog';
import { suggestDecisionTitle } from '@/lib/naming';
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
  const openDecision = decisions.find((d) => d.id === openId);

  async function handleAdd() {
    const title = await promptText({
      title: 'New decision',
      initialValue: suggestDecisionTitle(decisions),
      confirmLabel: 'Create',
    });
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
    const md = await fetchDecisionNarrative(id);
    setBody(md);
    setOpenId(id);
  }

  async function saveNarrative(value: string) {
    if (!openId) return;
    setBody(value);
    const r = await applyOperation({
      kind: 'SetDecisionNarrative', opId: `op_${Date.now()}`, decisionId: openId, body: value,
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
            <h1 className="text-lg font-semibold text-body">Decision Log</h1>
            <span className="text-xs text-faint">({decisions.length})</span>
            <button onClick={handleAdd} className="ml-auto btn btn-md btn-primary">
              <Plus className="w-3 h-3" /> New decision
            </button>
          </div>
          {decisions.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-700 mb-2" />
              <p className="text-sm text-muted">No decisions yet.</p>
              <p className="text-xs text-faint mt-1">Click "New decision" above to record one.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {decisions.map((d) => (
                <li
                  key={d.id}
                  className="surface rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => openNarrative(d.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={clsx(
                          'badge',
                          STATUS_COLORS[d.status] ?? 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30'
                        )}>{d.status}</span>
                        {d.date && <span className="text-[11px] text-faint font-mono">{d.date}</span>}
                        <select
                          value={d.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(ev) => handleStatusChange(d, ev.target.value)}
                          className="ml-auto text-[10px] bg-transparent border border-default rounded px-1 py-0.5"
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <span className="text-[10px] text-faint font-mono">{d.id}</span>
                      </div>
                      <h3 className="text-sm font-medium mt-1 text-body">{d.title}</h3>
                    </div>
                    <Edit3 className="w-3.5 h-3.5 text-faint shrink-0" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <NotesModal
        open={openId !== null}
        title={openDecision ? `Decision — ${openDecision.title}` : 'Decision narrative'}
        initialValue={body}
        onClose={() => setOpenId(null)}
        onSave={saveNarrative}
      />
    </div>
  );
}
