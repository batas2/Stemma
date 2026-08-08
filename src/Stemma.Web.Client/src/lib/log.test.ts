import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  log, records, clearRecords, setLogLevel, getLogLevel, isEnabled,
  beginAction, endAction, correlationId, withAction, correlationHeaders,
  reportFailure, newCorrelationId, ClientEvent, MAX_RECORDS, CORRELATION_HEADER,
} from './log';

beforeEach(() => {
  clearRecords();
  setLogLevel('trace');
  endAction();
  vi.restoreAllMocks();
});

describe('level filtering', () => {
  it('keeps records at or above the minimum and drops the rest', () => {
    setLogLevel('warn');
    log('debug', 'Stemma.Client.Test', 1, 'quiet');
    log('info', 'Stemma.Client.Test', 2, 'also quiet');
    log('warn', 'Stemma.Client.Test', 3, 'loud');
    log('error', 'Stemma.Client.Test', 4, 'louder');
    expect(records().map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('reports what it will keep before anything is built', () => {
    // The guard a caller uses before assembling an expensive property bag.
    setLogLevel('info');
    expect(isEnabled('debug')).toBe(false);
    expect(isEnabled('error')).toBe(true);
    expect(getLogLevel()).toBe('info');
  });

  it('returns null for a dropped record, so a caller can tell', () => {
    setLogLevel('error');
    expect(log('info', 'Stemma.Client.Test', 1, 'dropped')).toBeNull();
    expect(log('error', 'Stemma.Client.Test', 1, 'kept')).not.toBeNull();
  });
});

describe('the ring buffer', () => {
  it('evicts the oldest rather than growing without bound', () => {
    // A long session must not turn a diagnostic aid into a memory leak.
    for (let i = 0; i < MAX_RECORDS + 50; i++) log('info', 'Stemma.Client.Test', 1, `record ${i}`);
    expect(records()).toHaveLength(MAX_RECORDS);
    expect(records()[0].message).toBe('record 50');
    expect(records().at(-1)!.message).toBe(`record ${MAX_RECORDS + 49}`);
  });

  it('keeps insertion order', () => {
    log('info', 'Stemma.Client.Test', 1, 'first');
    log('info', 'Stemma.Client.Test', 2, 'second');
    expect(records().map((r) => r.message)).toEqual(['first', 'second']);
  });
});

describe('record shape', () => {
  it('keeps properties structured rather than folded into the message', () => {
    // The bundle redacts by property. An interpolated message has nothing left to redact, which is
    // the whole reason this API takes props separately.
    log('error', 'Stemma.Client.Api', ClientEvent.RequestFailed, 'Snapshot failed', { status: 500 });
    const record = records()[0];
    expect(record.message).not.toContain('500');
    expect(record.props).toEqual({ status: 500 });
    expect(record.eventId).toBe(ClientEvent.RequestFailed);
    expect(record.category).toBe('Stemma.Client.Api');
  });

  it('timestamps every record in a sortable form', () => {
    log('info', 'Stemma.Client.Test', 1, 'x');
    expect(() => new Date(records()[0].ts).toISOString()).not.toThrow();
  });
});

describe('correlation', () => {
  it('has no id outside an action, and sends no header', () => {
    expect(correlationId()).toBeNull();
    expect(correlationHeaders()).toEqual({});
  });

  it('stamps every record produced during an action', async () => {
    await withAction(async (id) => {
      log('info', 'Stemma.Client.Test', 1, 'inside');
      expect(correlationHeaders()).toEqual({ [CORRELATION_HEADER]: id });
    });
    expect(records()[0].correlationId).toBeTruthy();
  });

  it('restores the previous action afterwards, so nested calls do not leak', async () => {
    const outer = beginAction();
    await withAction(async () => { /* an inner action */ });
    expect(correlationId()).toBe(outer);
  });

  it('restores the previous action even when the body throws', async () => {
    const outer = beginAction();
    await expect(withAction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(correlationId()).toBe(outer);
  });

  it('is one id per action, not per call — a drag makes several requests', async () => {
    await withAction(async () => {
      const first = correlationHeaders()[CORRELATION_HEADER];
      const second = correlationHeaders()[CORRELATION_HEADER];
      expect(first).toBe(second);
    });
  });

  it('generates a usable id without crypto.randomUUID, which an insecure origin lacks', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => { throw new Error('unavailable'); });
    // The fallback path must still produce something, rather than taking the app down.
    expect(() => newCorrelationId()).not.toThrow();
  });
});

describe('reportFailure', () => {
  it('turns a rejected promise into exactly one error record', async () => {
    await Promise.reject(new Error('network down'))
      .catch(reportFailure('Api', ClientEvent.RequestFailed, 'Snapshot'));

    expect(records()).toHaveLength(1);
    const record = records()[0];
    expect(record.level).toBe('error');
    expect(record.message).toBe('Snapshot failed');
    expect(record.props?.error).toBe('network down');
  });

  it('swallows the rejection so a best-effort call still resolves', async () => {
    const result = await Promise.reject(new Error('x'))
      .catch(reportFailure('Api', ClientEvent.RequestFailed, 'Something'));
    expect(result).toBeUndefined();
  });

  it('handles a rejection that is not an Error', async () => {
    await Promise.reject('just a string').catch(reportFailure('Api', ClientEvent.RequestFailed, 'Odd'));
    expect(records()[0].props?.error).toBe('just a string');
  });
});
