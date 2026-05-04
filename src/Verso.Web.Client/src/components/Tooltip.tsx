import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  label: ReactNode;
  shortcut?: string;
  delay?: number;
  side?: 'top' | 'bottom';
  children: ReactNode;
}

export function Tooltip({ label, shortcut, delay = 500, side = 'bottom', children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = wrapRef.current?.firstElementChild as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      if (!r) return;
      const x = r.left + r.width / 2;
      const y = side === 'top' ? r.top - 6 : r.bottom + 6;
      setPos({ x, y });
      setOpen(true);
    }, delay);
  }, [delay, side]);

  const hide = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <>
      <span
        ref={wrapRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="contents"
      >
        {children}
      </span>
      {open && pos && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform: side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
          className="z-popover pointer-events-none px-2 py-1 rounded text-[11px] bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-lg whitespace-nowrap flex items-center gap-2"
        >
          <span>{label}</span>
          {shortcut && <kbd className="text-[10px] font-mono bg-white/15 dark:bg-zinc-900/15 px-1 py-0.5 rounded">{shortcut}</kbd>}
        </div>,
        document.body
      )}
    </>
  );
}
