import { type NodeProps, type Node } from '@xyflow/react';

export type BcBackdropData = {
  width: number;
  height: number;
  label: string;
} & Record<string, unknown>;

export type BcBackdropNode = Node<BcBackdropData, 'bcBackdrop'>;

// Q114: visual subgraph backdrop for a Bounded Context. Rendered as a node so
// pan/zoom + persistence flow through xyflow as usual; sized from the bounding
// box of contained modules at compute time. Pointer events are disabled so it
// never steals clicks from the modules sitting on top.
export function BcBackdrop({ data }: NodeProps<BcBackdropNode>) {
  return (
    <div
      style={{
        width: data.width,
        height: data.height,
        pointerEvents: 'none',
      }}
      className="rounded-2xl border-2 border-dashed border-violet-400/50 dark:border-violet-500/40 bg-violet-500/5 dark:bg-violet-500/10"
    >
      <div className="absolute -top-3 left-3 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30">
        {data.label}
      </div>
    </div>
  );
}
