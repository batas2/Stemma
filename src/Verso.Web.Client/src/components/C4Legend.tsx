import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Persistent legend for the C4 view — shapes / colours / boundary meanings, modelled on the
 * C4 reference card. Bottom-right of the canvas; collapsible. Hidden on every other view.
 */
export function C4Legend() {
  const [open, setOpen] = useState(true);
  return (
    <div className="absolute right-3 bottom-3 z-popover surface-overlay rounded-md border border-default text-[11px] max-w-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-body hover:bg-zinc-100 dark:hover:bg-zinc-800/40"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        <span className="font-medium">C4 legend</span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1.5 text-[10px]">
          <Row swatch={<div className="w-4 h-4 rounded-full border border-amber-500/60" />} label="Person — actor / role" />
          <Row swatch={<div className="w-4 h-4 rounded-md border border-emerald-500/60 bg-emerald-500/5" />} label="Software System (in scope)" />
          <Row swatch={<div className="w-4 h-4 rounded-md border border-dashed border-zinc-400 bg-zinc-300/15" />} label="External system / actor" />
          <Row swatch={<div className="w-4 h-4 rounded-md border border-emerald-400/60" />} label="Container — deployable unit" />
          <Row swatch={<div className="w-4 h-4 rounded-md border border-indigo-500/60" />} label="Module — feature / component" />
          <hr className="border-subtle my-1" />
          <Row swatch={<svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="rgb(99 102 241)" strokeWidth="2" /></svg>} label="Data flow — solid" />
          <Row swatch={<svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="rgb(99 102 241)" strokeWidth="2" strokeDasharray="4 3" /></svg>} label="Dependency — dashed" />
        </div>
      )}
    </div>
  );
}

function Row({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 flex items-center justify-center w-4 h-4">{swatch}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}
