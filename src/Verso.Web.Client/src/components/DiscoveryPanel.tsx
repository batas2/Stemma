import { useEffect, useMemo, useState } from 'react';
import { Bot, Compass, Folder, Hash, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { useApp } from '@/lib/store';
import {
  analyseModule, fetchAiStatus, fetchDiscovery, runDiscovery,
  type AiAnalysisResult, type DiscoveryBundle, type DiscoveredModule, type ModuleMetric,
} from '@/lib/discovery';

/** Sidebar tab that surfaces the discovered model: modules / namespaces / projects, with metrics. */
export function DiscoveryPanel() {
  const ws = useApp((s) => s.workspace);
  const setToast = useApp((s) => s.setToast);
  const [bundle, setBundle] = useState<DiscoveryBundle | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<'modules' | 'namespaces' | 'projects'>('modules');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!ws) { setBundle(null); setSelectedId(null); return; }
    fetchDiscovery().then((b) => { if (b) setBundle(b); }).catch(() => {});
  }, [ws?.rootPath]);

  async function onRun() {
    if (!ws) return;
    setRunning(true);
    try {
      const b = await runDiscovery();
      setBundle(b);
      setToast({ kind: 'success', text: `Discovery complete: ${b.discovered.modules.length} modules, ${b.discovered.edges.length} edges.` });
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  const filteredModules = useMemo(() => {
    if (!bundle) return [];
    const q = query.trim().toLowerCase();
    return bundle.discovered.modules
      .filter((m) => !q || m.name.toLowerCase().includes(q) || (m.namespacePrefix?.toLowerCase().includes(q) ?? false))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bundle, query]);

  const metricById = useMemo(() => {
    const map = new Map<string, number>();
    bundle?.metrics.modules.forEach((m) => map.set(m.moduleId, m.distanceFromMainSequence));
    return map;
  }, [bundle]);

  if (!ws) return null;

  const selected = selectedId && bundle
    ? bundle.discovered.modules.find((m) => m.id === selectedId) ?? null
    : null;
  const selectedMetric = selected && bundle
    ? bundle.metrics.modules.find((m) => m.moduleId === selected.id) ?? null
    : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-default flex items-center gap-2">
        <Compass className="w-3.5 h-3.5 text-indigo-500" />
        <span className="text-xs font-semibold text-body">Discovered</span>
        <button
          onClick={onRun}
          disabled={running}
          aria-label={bundle ? 'Re-run discovery' : 'Run discovery'}
          title={bundle ? 'Re-run discovery' : 'Run discovery'}
          className="ml-auto btn btn-sm btn-ghost"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {bundle ? 'Refresh' : 'Discover'}
        </button>
      </div>

      {!bundle ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 gap-3 text-muted">
          <Sparkles className="w-6 h-6 text-indigo-400" />
          <div className="text-xs leading-relaxed">
            Verso can read this workspace and propose modules, typed dependencies, and software metrics.
            Click <strong className="text-body">Discover</strong> to start. Output is cached as
            <code className="ml-1">discovered.verso.json</code>.
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 pt-2 flex gap-1 border-b border-default">
            {(['modules', 'namespaces', 'projects'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-[11px] px-2 py-1 rounded-t-md transition ${
                  tab === t ? 'bg-zinc-200/60 dark:bg-zinc-800/60 text-body' : 'text-muted hover:text-body'
                }`}
              >
                {t === 'modules' && `Modules (${bundle.discovered.modules.length})`}
                {t === 'namespaces' && `Namespaces (${bundle.discovered.namespaces.length})`}
                {t === 'projects' && `Projects (${bundle.discovered.projects.length})`}
              </button>
            ))}
          </div>

          <div className="px-3 py-2 border-b border-default">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter discovered items"
              className="input-base w-full text-xs"
            />
          </div>

          <div className="flex-1 overflow-auto">
            {tab === 'modules' && (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {filteredModules.map((m) => (
                  <ModuleRow
                    key={m.id}
                    module={m}
                    d={metricById.get(m.id) ?? 0}
                    onSelect={() => setSelectedId(m.id === selectedId ? null : m.id)}
                    selected={m.id === selectedId}
                  />
                ))}
                {filteredModules.length === 0 && (
                  <div className="px-3 py-6 text-xs text-faint text-center">No modules match.</div>
                )}
              </div>
            )}
            {tab === 'namespaces' && (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {bundle.discovered.namespaces.map((ns) => (
                  <div key={ns.fqn} className="px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <div className="flex items-center gap-2 text-xs">
                      <Hash className="w-3 h-3 text-faint" />
                      <span className="font-mono text-body">{ns.fqn}</span>
                    </div>
                    <div className="text-[10px] text-faint mt-0.5">{ns.typeIds.length} types</div>
                  </div>
                ))}
              </div>
            )}
            {tab === 'projects' && (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {bundle.discovered.projects.map((p) => (
                  <div key={p.id} className="px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <div className="flex items-center gap-2 text-xs">
                      <Folder className="w-3 h-3 text-faint" />
                      <span className="font-medium text-body">{p.name}</span>
                      <span className="ml-auto text-[10px] text-faint">{p.targetFramework}</span>
                    </div>
                    <div className="text-[10px] text-faint mt-0.5">
                      {p.typeIds.length} types · {p.projectReferences.length} project refs
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <ModuleDetailCard
              module={selected}
              metric={selectedMetric}
              onClose={() => setSelectedId(null)}
            />
          )}

          <div className="px-3 py-2 border-t border-default text-[10px] text-faint">
            Avg D = {bundle.metrics.workspaceAvgDistanceFromMainSequence.toFixed(2)} ·
            {' '}{bundle.discovered.edges.length} edges ·
            {' '}{bundle.recommendations.length} suggested views
          </div>
        </>
      )}
    </div>
  );
}

function ModuleRow({ module: m, d, onSelect, selected }: {
  module: DiscoveredModule; d: number; onSelect: () => void; selected: boolean;
}) {
  // Colour the D dot from green (0, on the main sequence) → red (1, far from it)
  const color = dColor(d);
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 transition ${selected
        ? 'bg-indigo-500/10 dark:bg-indigo-500/20'
        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40'}`}
      title={m.rationale}
    >
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="font-medium text-body truncate">{m.name}</span>
        <span className="ml-auto text-[10px] text-faint shrink-0">D={d.toFixed(2)}</span>
      </div>
      <div className="text-[10px] text-faint mt-0.5 truncate font-mono">
        {m.namespacePrefix ?? '(none)'} · {m.typeIds.length} types · conf {Math.round(m.confidence * 100)}%
      </div>
    </button>
  );
}

/** Detail card rendered when a module is selected — shows metric grid + Claude analysis affordance. */
function ModuleDetailCard({ module: m, metric, onClose }: {
  module: DiscoveredModule;
  metric: ModuleMetric | null;
  onClose: () => void;
}) {
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; transport: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null);

  useEffect(() => { fetchAiStatus().then(setAiStatus).catch(() => setAiStatus({ configured: false, transport: 'unknown' })); }, []);
  useEffect(() => { setAiResult(null); }, [m.id]);

  const aiConfigured = aiStatus?.configured ?? null;
  const aiTransport = aiStatus?.transport ?? 'http';

  async function onAnalyse(template: 'discover-structure' | 'summarise') {
    setAiBusy(true);
    setAiResult(null);
    try {
      const r = await analyseModule(m.id, template);
      setAiResult(r);
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="border-t border-default surface-elevated px-3 py-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-body truncate">{m.name}</div>
          <div className="text-[10px] text-faint font-mono truncate">{m.namespacePrefix ?? '(no namespace)'}</div>
        </div>
        <button onClick={onClose} aria-label="Close detail" className="text-faint hover:text-body">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {metric && (
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <Stat label="Types" value={metric.typeCount} />
          <Stat label="Ca" value={metric.ca} />
          <Stat label="Ce" value={metric.ce} />
          <Stat label="I" value={metric.instability.toFixed(2)} />
          <Stat label="A" value={metric.abstractness.toFixed(2)} />
          <Stat label="D" value={metric.distanceFromMainSequence.toFixed(2)} highlight={metric.distanceFromMainSequence > 0.6} />
          <Stat label="RC" value={metric.relationalCohesion.toFixed(2)} />
          <Stat label="Internal" value={metric.internalEdges} />
          <Stat label="External" value={metric.externalEdges} />
        </div>
      )}

      <div className="mt-3 border-t border-subtle pt-3">
        <div className="flex items-center gap-2 text-[11px] mb-2">
          <Bot className="w-3 h-3 text-indigo-500" />
          <span className="font-semibold text-body">Claude analysis</span>
          {aiConfigured === true && (
            <span className="ml-auto text-[10px] font-mono text-faint" title={`Transport: ${aiTransport}`}>
              via {aiTransport}
            </span>
          )}
          {aiConfigured === false && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-auto">
              {aiTransport === 'cli' ? 'claude CLI not ready' : 'No API key'}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onAnalyse('summarise')}
            disabled={aiBusy || aiConfigured === false}
            className="btn btn-sm btn-secondary flex-1 justify-center"
          >
            {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Summarise
          </button>
          <button
            onClick={() => onAnalyse('discover-structure')}
            disabled={aiBusy || aiConfigured === false}
            className="btn btn-sm btn-secondary flex-1 justify-center"
          >
            Deep analysis
          </button>
        </div>
        {aiConfigured === false && (
          <p className="text-[10px] text-faint mt-2 leading-snug">
            {aiTransport === 'cli' ? (
              <>Install <code>claude</code> CLI (<code>npm i -g @anthropic-ai/claude-code</code>) and run <code>claude login</code>. Or pin HTTP via <code>VERSO_AI_TRANSPORT=http</code>.</>
            ) : (
              <>Set <code>ANTHROPIC_API_KEY</code> or write <code>~/.verso/credentials.json</code> with <code>{'{ "anthropicApiKey": "..." }'}</code>. Or pin CLI via <code>VERSO_AI_TRANSPORT=cli</code>.</>
            )}
          </p>
        )}
        {aiResult && (
          <pre className="mt-2 text-[10px] bg-zinc-100 dark:bg-zinc-900 p-2 rounded max-h-64 overflow-auto whitespace-pre-wrap break-words">
            {aiResult.ok
              ? (aiResult.resultJson ?? '(empty)')
              : `Error: ${aiResult.errorCode} — ${aiResult.errorMessage ?? ''}`}
          </pre>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`rounded surface px-2 py-1 ${highlight ? 'ring-1 ring-rose-400/60' : ''}`}>
      <div className="text-[9px] uppercase text-faint tracking-wider">{label}</div>
      <div className="text-xs font-mono text-body">{value}</div>
    </div>
  );
}

function dColor(d: number): string {
  if (d < 0.2) return '#22c55e';
  if (d < 0.4) return '#84cc16';
  if (d < 0.6) return '#eab308';
  if (d < 0.8) return '#f97316';
  return '#ef4444';
}
