import clsx from 'clsx';

interface MarkProps {
  size?: number;
  className?: string;
}

/**
 * The Stemma mark — a folded-corner page (the "stemma" of the metaphor) with a subtle "V"
 * inscription. Uses an indigo gradient by default; pass `monochrome` for a single-tone
 * version that inherits color from the surrounding text.
 */
export function StemmaMark({ size = 20, className, monochrome = false }: MarkProps & { monochrome?: boolean }) {
  if (monochrome) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
        <path d="M8 4 H19 L26 11 V26 A2 2 0 0 1 24 28 H8 A2 2 0 0 1 6 26 V6 A2 2 0 0 1 8 4 Z" fill="currentColor" />
        <path d="M19 4 V10 A1 1 0 0 0 20 11 H26 L19 4 Z" fill="currentColor" fillOpacity="0.55" />
        <path d="M11.5 14 L16 22 L20.5 14" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`vg-${size}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <path d="M8 4 H19 L26 11 V26 A2 2 0 0 1 24 28 H8 A2 2 0 0 1 6 26 V6 A2 2 0 0 1 8 4 Z" fill={`url(#vg-${size})`} />
      <path d="M19 4 V10 A1 1 0 0 0 20 11 H26 L19 4 Z" fill="#a5b4fc" />
      <path d="M19 4 L26 11" stroke="#312e81" strokeOpacity="0.18" strokeWidth="0.5" />
      <path d="M11.5 14 L16 22 L20.5 14" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.92" />
    </svg>
  );
}

/**
 * The full lockup: mark + wordmark + tagline. Use in topbar / empty state.
 */
export function StemmaLockup({ size = 22, showTagline = true, className }: { size?: number; showTagline?: boolean; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)}>
      <StemmaMark size={size} />
      <div className="flex flex-col leading-none">
        <span
          className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          style={{ fontSize: size * 0.78, letterSpacing: '-0.01em' }}
        >
          Stemma
        </span>
        {showTagline && (
          <span
            className="text-zinc-500 dark:text-zinc-500 mt-0.5"
            style={{ fontSize: size * 0.42, letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            the living architecture model
          </span>
        )}
      </div>
    </div>
  );
}
