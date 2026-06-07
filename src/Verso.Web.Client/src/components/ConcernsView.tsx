import { HelpCircle, Lightbulb, AlertTriangle, Plus } from 'lucide-react';
import { useApp } from '@/lib/store';
import { applyOperation } from '@/lib/signalr';
import { suggestElementName } from '@/lib/naming';
import { friendlyOpError } from '@/lib/opError';
import type { ArchElementKind } from '@/lib/types';

/** Full-page summary of every Question / Assumption / Risk in the model. */
const SECTIONS: { kind: ArchElementKind; label: string; icon: typeof HelpCircle; accent: string; card: string }[] = [
  { kind: 'question', label: 'Questions', icon: HelpCircle, accent: 'text-sky-600 dark:text-sky-400', card: 'bg-sky-500/10 border-sky-500/30' },
  { kind: 'assumption', label: 'Assumptions', icon: Lightbulb, accent: 'text-amber-600 dark:text-amber-400', card: 'bg-amber-500/10 border-amber-500/30' },
  { kind: 'risk', label: 'Risks', icon: AlertTriangle, accent: 'text-rose-600 dark:text-rose-400', card: 'bg-rose-500/10 border-rose-500/30' },
];

export function ConcernsView() {
  const arch = useApp((s) => s.arch);
  const select = useApp((s) => s.selectElement);
  const setView = useApp((s) => s.setView);
  const setToast = useApp((s) => s.setToast);
  const elements = arch?.elements ?? [];
  const nameById = new Map(elements.map((e) => [e.id, e.name] as const));

  async function add(kind: ArchElementKind) {
    const name = suggestElementName(kind, elements);
    const r = await applyOperation({ kind: 'AddElement', opId: `op_${Date.now()}`, elementKind: kind, name });
    setToast('reason' in r ? { kind: 'error', text: friendlyOpError(r) } : { kind: 'success', text: `Added ${name}` });
  }

  function open(id: string) {
    setView('moduleMap');
    select(id);
    if (typeof window !== 'undefined') {
      setTimeout(() => window.dispatchEvent(new CustomEvent('verso:focus-node', { detail: { nodeId: id } })), 60);
    }
  }

  return (
    <div className="h-full overflow-auto p-6 bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-body">Concerns</h1>
          <p className="text-xs text-faint mt-1">
            Every Question, Assumption, and Risk in the model. Click one to open it on the{' '}
            <button onClick={() => setView('moduleMap')} className="text-indigo-500 hover:underline">Module Map</button>.
          </p>
        </div>
        {SECTIONS.map(({ kind, label, icon: Icon, accent, card }) => {
          const items = elements.filter((e) => e.kind === kind);
          return (
            <section key={kind}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${accent}`} />
                <h2 className="text-sm font-medium text-body">{label}</h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-muted">{items.length}</span>
                <button onClick={() => add(kind)} className="ml-auto text-[11px] flex items-center gap-1 px-2 py-1 rounded border border-default text-muted hover:text-body">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {items.length === 0 ? (
                <p className="text-xs text-faint italic px-1">None yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((e) => {
                    const aboutId = e.attributes.aboutId ?? null;
                    const aboutName = aboutId ? nameById.get(aboutId) : null;
                    return (
                      <li key={e.id}>
                        <button onClick={() => open(e.id)} className={`w-full text-left px-3 py-2 rounded border transition hover:brightness-105 ${card}`}>
                          <div className="text-sm text-body">{e.name}</div>
                          {aboutId && (
                            <div className="text-[11px] text-muted mt-0.5">
                              about <span className="font-medium">{aboutName ?? aboutId}</span>
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
