import { ArrowUp, Sparkles, FileCode, Lightbulb, Layers } from 'lucide-react';
import { StemmaMark } from './Logo';

export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-xl px-6 py-12">
        <div className="text-center mb-10">
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <Highlight icon={FileCode} title="Code as database" body="Everything is .cs and .md. No proprietary store." />
          <Highlight icon={Lightbulb} title="Decisions in source" body="ADRs, options, lifecycle — all checked in." />
          <Highlight icon={Layers} title="Layered & multi-audience" body="Navigate by layer — System, Data, Governance, Code — re-aimed per audience." />
        </div>

        <div className="text-xs text-zinc-500 flex items-center justify-center gap-1.5">
          <ArrowUp className="w-3.5 h-3.5" />
          Enter a workspace path above, or click <strong className="font-medium text-zinc-700 dark:text-zinc-300">Recent</strong> / <strong className="font-medium text-zinc-700 dark:text-zinc-300">Create</strong>
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
