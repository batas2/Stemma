import { useApp } from '@/lib/store';

export function TopProgressBar() {
  const loading = useApp((s) => s.loading);
  if (!loading) return null;
  return (
    <div className="fixed left-0 right-0 top-0 h-0.5 z-toast pointer-events-none overflow-hidden">
      <div
        className="h-full w-1/3 bg-indigo-500"
        style={{ animation: 'stemma-progress 1.2s ease-in-out infinite' }}
      />
      <style>{`
        @keyframes stemma-progress {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(180%); }
          100% { transform: translateX(380%); }
        }
      `}</style>
    </div>
  );
}

export function SkeletonCanvas() {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-faint">
      <div className="grid grid-cols-3 gap-3 opacity-60">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="w-40 h-16 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/60 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
