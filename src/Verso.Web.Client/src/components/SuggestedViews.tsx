import { useEffect, useState } from 'react';
import { Lightbulb, Plus } from 'lucide-react';
import { useApp } from '@/lib/store';
import { fetchDiscovery, type RecommendedView } from '@/lib/discovery';

/** Sidebar block beneath custom Views: lists recommender candidates with a one-click adopt action. */
export function SuggestedViews() {
  const ws = useApp((s) => s.workspace);
  const customViews = useApp((s) => s.customViews);
  const upsertCustomView = useApp((s) => s.upsertCustomView);
  const setActive = useApp((s) => s.setActiveCustomView);
  const setToast = useApp((s) => s.setToast);
  const [recs, setRecs] = useState<RecommendedView[]>([]);

  useEffect(() => {
    if (!ws) { setRecs([]); return; }
    fetchDiscovery().then((b) => setRecs(b?.recommendations ?? [])).catch(() => {});
  }, [ws?.rootPath, customViews.length]);

  if (!ws || recs.length === 0) return null;

  function adopt(rec: RecommendedView) {
    const id = `cv_${rec.id.replace(/[^a-z0-9]/gi, '_').slice(0, 24)}_${Date.now().toString(36).slice(-4)}`;
    upsertCustomView({
      id,
      name: rec.name,
      baseView: 'all',
      elementIds: [],   // Discovered modules don't have ArchElement ids; they live in the discovery layer.
      createdAt: new Date().toISOString(),
    });
    setActive(id);
    setToast({ kind: 'success', text: `Adopted "${rec.name}".` });
  }

  return (
    <div className="border-t border-default mt-2">
      <div className="px-3 pt-3 pb-1 flex items-center gap-2">
        <Lightbulb className="w-3 h-3 text-amber-500" />
        <span className="text-[11px] font-semibold text-body">Suggested views</span>
        <span className="text-[10px] text-faint ml-auto">{recs.length}</span>
      </div>
      <div className="px-2 pb-2 space-y-1">
        {recs.slice(0, 5).map((r) => (
          <div
            key={r.id}
            className="rounded-md border border-subtle px-2 py-1.5 hover:border-default surface"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-body truncate">{r.name}</div>
                <div className="text-[10px] text-muted mt-0.5 line-clamp-2">{r.intent}</div>
                <div className="text-[10px] text-faint mt-0.5 font-mono">
                  {r.audience} · {r.layout} · score {r.valueScore.toFixed(2)}
                </div>
              </div>
              <button
                onClick={() => adopt(r)}
                aria-label={`Adopt ${r.name}`}
                title="Add to my views"
                className="p-1 rounded hover:bg-indigo-500/10 text-indigo-500"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
