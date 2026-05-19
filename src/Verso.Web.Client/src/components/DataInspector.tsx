import { Database, Layers, Hexagon, ShieldCheck, Activity, ArrowRight } from 'lucide-react';
import { useApp } from '@/lib/store';
import { ResizableAside } from './ResizableAside';

/**
 * Epic 08 C6 — Inspector for YAML-sourced data-layer concepts.
 *
 * Shows the canonical fields of a `YamlConcept` (id, kind, name, layer),
 * any free-form `properties`, declared `aliases`, and the incoming/outgoing
 * `YamlRelation`s. Editing is intentionally read-only in v1 — operations to
 * mutate the yaml adapter through the engine are tracked separately under
 * Track B.
 */
const KIND_ICON: Record<string, typeof Database> = {
  AggregateRoot: Database,
  DomainEntity: Layers,
  ValueObject: Hexagon,
  Resource: ShieldCheck,
};

export function DataInspector() {
  const selectedId = useApp((s) => s.selectedYamlConceptId);
  const concepts = useApp((s) => s.yamlConcepts);
  const relations = useApp((s) => s.yamlRelations);

  if (!selectedId) {
    return (
      <ResizableAside className="hidden lg:flex">
        <div className="p-6 text-center mt-8">
          <Activity className="w-7 h-7 text-zinc-300 dark:text-zinc-700 mb-3 mx-auto" />
          <p className="text-sm font-medium text-body mb-1">Data Inspector</p>
          <p className="text-xs text-faint mb-4">Click a concept to inspect its properties and relations.</p>
        </div>
      </ResizableAside>
    );
  }

  const concept = concepts.find((c) => c.id === selectedId);
  if (!concept) {
    return (
      <ResizableAside className="hidden lg:flex">
        <div className="p-4 text-xs text-faint">Concept no longer in model.</div>
      </ResizableAside>
    );
  }

  const Icon = KIND_ICON[concept.kind] ?? Layers;
  const outgoing = relations.filter((r) => r.from === concept.id);
  const incoming = relations.filter((r) => r.to === concept.id);

  function nameOf(id: string): string {
    return concepts.find((c) => c.id === id)?.name ?? id;
  }

  const userProps = Object.entries(concept.properties).filter(([k]) => !k.startsWith('action_') && k !== 'parent');
  const actions = Object.entries(concept.properties).filter(([k]) => k.startsWith('action_'));
  const parentId = concept.properties['parent'];

  return (
    <ResizableAside className="hidden lg:flex">
      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            <Icon className="w-3 h-3" /> {concept.kind}
          </div>
          <h2 className="text-base font-semibold text-body mt-0.5">{concept.name}</h2>
          <code className="text-[11px] text-faint font-mono">{concept.id}</code>
        </div>

        <Section title="Fields">
          <Row label="layer">{concept.layer ?? <span className="text-faint">—</span>}</Row>
          {parentId && <Row label="parent">{nameOf(parentId)}</Row>}
          {concept.aliases.length > 0 && (
            <Row label="aliases">{concept.aliases.join(', ')}</Row>
          )}
        </Section>

        {userProps.length > 0 && (
          <Section title="Properties">
            {userProps.map(([k, v]) => (
              <Row key={k} label={k}>{v ?? <span className="text-faint">—</span>}</Row>
            ))}
          </Section>
        )}

        {actions.length > 0 && (
          <Section title="Actions">
            <div className="flex flex-wrap gap-1">
              {actions.map(([k, v]) => (
                <span
                  key={k}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-mono"
                >
                  {k.slice('action_'.length)}{v ? ` (${v})` : ''}
                </span>
              ))}
            </div>
          </Section>
        )}

        {(outgoing.length > 0 || incoming.length > 0) && (
          <Section title="Relations">
            {outgoing.map((r) => (
              <div key={r.id} className="text-xs text-body flex items-center gap-1.5 py-0.5">
                <span className="text-[10px] uppercase tracking-wide text-violet-500 font-medium w-20 shrink-0">{r.kind}</span>
                <ArrowRight className="w-3 h-3 text-faint" />
                <span className="truncate">{nameOf(r.to)}</span>
              </div>
            ))}
            {incoming.map((r) => (
              <div key={r.id} className="text-xs text-body flex items-center gap-1.5 py-0.5">
                <span className="text-[10px] uppercase tracking-wide text-faint w-20 shrink-0">in: {r.kind}</span>
                <ArrowRight className="w-3 h-3 text-faint rotate-180" />
                <span className="truncate">{nameOf(r.from)}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </ResizableAside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-xs flex items-baseline gap-2">
      <span className="text-faint w-20 shrink-0 font-mono text-[11px]">{label}</span>
      <span className="text-body truncate">{children}</span>
    </div>
  );
}
