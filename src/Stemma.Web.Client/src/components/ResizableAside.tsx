import { useEffect, useRef, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'stemma.inspector.width';
const MIN = 280;
const MAX = 600;
const DEFAULT_WIDTH = 320;

function readWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  if (!Number.isFinite(raw) || raw < MIN || raw > MAX) return DEFAULT_WIDTH;
  return raw;
}

interface Props {
  className?: string;
  children: ReactNode;
}

export function ResizableAside({ className = '', children }: Props) {
  const [width, setWidth] = useState(readWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(width);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx = startX.current - e.clientX;
      const next = Math.min(MAX, Math.max(MIN, startW.current + dx));
      setWidth(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      localStorage.setItem(STORAGE_KEY, String(width));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [width]);

  function onHandleDown(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  return (
    <aside
      style={{ width }}
      className={`shrink-0 border-l border-default bg-white dark:bg-zinc-950/60 flex flex-col overflow-hidden relative ${className}`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        onMouseDown={onHandleDown}
        className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-chrome group"
      >
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-transparent group-hover:bg-indigo-400/60 transition-colors" />
      </div>
      {children}
    </aside>
  );
}
