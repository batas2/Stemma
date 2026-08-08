/**
 * Client-side diagnostics, in the same shape as the backend's (ADR-0020).
 *
 * Twenty-one promise chains used to end in `.catch(() => {})`. Each one is a thing that can fail
 * while the user watches nothing happen, and none of them left a trace. This is where they go
 * instead.
 *
 * Two deliberate constraints:
 *
 * - **Records are never streamed.** They reach disk only when the user builds a diagnostics bundle.
 *   A client log that ships itself somewhere is a telemetry pipe by another name, and a Stemma
 *   record carries the user's architecture. The cost is that a crash before the bundle is
 *   unrecoverable; that is accepted.
 * - **The buffer is bounded.** A ring buffer, not a growing array — a long session must not turn a
 *   diagnostic aid into a memory leak.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** Ordered so a numeric comparison filters, matching the backend's level ordering. */
const LEVEL_ORDER: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

export interface LogRecord {
  ts: string;
  level: LogLevel;
  /** `Stemma.Client.<Area>` — the same dot-separated scheme the backend filters on. */
  category: string;
  eventId: number;
  message: string;
  /** Structured properties. Never interpolate into `message`: the bundle redacts by property. */
  props?: Record<string, unknown>;
  /** The action this record belongs to, echoed by the server on the response. */
  correlationId?: string;
}

export const MAX_RECORDS = 500;

const buffer: LogRecord[] = [];
let minimum: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void { minimum = level; }
export function getLogLevel(): LogLevel { return minimum; }
export function records(): readonly LogRecord[] { return buffer; }
export function clearRecords(): void { buffer.length = 0; }

export function isEnabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minimum];
}

/**
 * Append a record, evicting the oldest once the buffer is full.
 *
 * Returns the record so a caller can attach it to a toast — the "Details" affordance on an error
 * needs the record it is about, not a search through the buffer for something that looks similar.
 */
export function log(
  level: LogLevel,
  category: string,
  eventId: number,
  message: string,
  props?: Record<string, unknown>,
): LogRecord | null {
  if (!isEnabled(level)) return null;

  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    category,
    eventId,
    message,
    props,
    correlationId: currentCorrelationId ?? undefined,
  };

  buffer.push(record);
  if (buffer.length > MAX_RECORDS) buffer.splice(0, buffer.length - MAX_RECORDS);

  // Mirrored to the console so a developer with devtools open does not have to open a panel. The
  // buffer is the record of truth; this is a convenience.
  if (level === 'error') console.error(`[${category}] ${message}`, props ?? '');
  else if (level === 'warn') console.warn(`[${category}] ${message}`, props ?? '');

  return record;
}

/** Event ids, 9000–9999 per ADR-0020. Stable: reword a message freely, never renumber. */
export const ClientEvent = {
  RequestFailed: 9001,
  OperationFailed: 9002,
  SidecarWriteFailed: 9003,
  ConnectionLost: 9004,
  ExportFailed: 9005,
  RenderStateError: 9006,
  Unhandled: 9099,
} as const;

// ---- correlation ------------------------------------------------------------------------------

/**
 * The id for the user action in flight.
 *
 * Per *action*, not per request: one canvas drag can produce several calls and they belong together.
 * `beginAction` is called where the user does something, not where a fetch is issued.
 */
let currentCorrelationId: string | null = null;

export const CORRELATION_HEADER = 'X-Correlation-Id';

export function newCorrelationId(): string {
  // On an insecure origin — which a LAN dev host is — `randomUUID` is *present and throws*, so
  // optional chaining is not enough: it guards absence, not failure. An id is a correlation aid,
  // never a reason to take the app down.
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid.replace(/-/g, '').slice(0, 12);
  } catch {
    // Fall through to the non-cryptographic id below. Collision risk is irrelevant here: this
    // groups records inside one session, it is not a security boundary.
  }
  return Math.random().toString(16).slice(2, 14).padEnd(12, '0');
}

export function beginAction(id: string = newCorrelationId()): string {
  currentCorrelationId = id;
  return id;
}

export function endAction(): void { currentCorrelationId = null; }
export function correlationId(): string | null { return currentCorrelationId; }

/** Run `fn` inside a fresh correlation scope, restoring the previous one afterwards. */
export async function withAction<T>(fn: (id: string) => Promise<T>): Promise<T> {
  const previous = currentCorrelationId;
  const id = beginAction();
  try {
    return await fn(id);
  } finally {
    currentCorrelationId = previous;
  }
}

/** Headers carrying the current action, for a `fetch`. Empty when no action is in flight. */
export function correlationHeaders(): Record<string, string> {
  return currentCorrelationId ? { [CORRELATION_HEADER]: currentCorrelationId } : {};
}

/**
 * The one place a failed promise is turned into a record.
 *
 * Written to be usable as `.catch(reportFailure('Api', ClientEvent.RequestFailed, 'Snapshot'))`, so
 * replacing a silent `.catch(() => {})` is a one-line change and there is no excuse for leaving one.
 */
export function reportFailure(area: string, eventId: number, what: string) {
  return (error: unknown): undefined => {
    log('error', `Stemma.Client.${area}`, eventId, `${what} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  };
}
