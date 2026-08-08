import { describe, it, expect } from 'vitest';
import {
  resolveExportOptions,
  exportFileName,
  safeFileName,
  EXPORT_DEFAULTS,
  SCALE_MIN,
  SCALE_MAX,
  PADDING_MAX,
} from './exportImage';

const PAGE_BG = 'rgb(251, 251, 253)';

describe('resolveExportOptions', () => {
  it('bakes the page background in by default, so the toolbar button behaves as it always has', () => {
    const o = resolveExportOptions({ format: 'png' }, PAGE_BG);
    expect(o.backgroundColor).toBe(PAGE_BG);
    expect(o.pixelRatio).toBe(EXPORT_DEFAULTS.scale);
    expect(o.padding).toBe(EXPORT_DEFAULTS.padding);
  });

  it('leaves the backdrop unset when transparency is asked for', () => {
    // `undefined` is the contract html-to-image reads as "paint nothing". A colour of any kind —
    // including the string 'transparent' — makes it paint, which is the bug this replaces.
    expect(resolveExportOptions({ format: 'png', transparent: true }, PAGE_BG).backgroundColor).toBeUndefined();
  });

  it('falls back to white rather than producing an accidentally transparent opaque export', () => {
    expect(resolveExportOptions({ format: 'png' }, '').backgroundColor).toBe('#ffffff');
    expect(resolveExportOptions({ format: 'png' }, '   ').backgroundColor).toBe('#ffffff');
    expect(resolveExportOptions({ format: 'png' }, undefined).backgroundColor).toBe('#ffffff');
  });

  it('clamps scale into the supported range instead of trusting the caller', () => {
    expect(resolveExportOptions({ format: 'png', scale: 0 }).pixelRatio).toBe(SCALE_MIN);
    expect(resolveExportOptions({ format: 'png', scale: -3 }).pixelRatio).toBe(SCALE_MIN);
    expect(resolveExportOptions({ format: 'png', scale: 99 }).pixelRatio).toBe(SCALE_MAX);
    expect(resolveExportOptions({ format: 'png', scale: 3 }).pixelRatio).toBe(3);
  });

  it('clamps padding, and treats a non-finite value as "use the default"', () => {
    expect(resolveExportOptions({ format: 'png', padding: -1 }).padding).toBe(0);
    expect(resolveExportOptions({ format: 'png', padding: 10 }).padding).toBe(PADDING_MAX);
    expect(resolveExportOptions({ format: 'png', padding: 0 }).padding).toBe(0);
    expect(resolveExportOptions({ format: 'png', padding: Number.NaN }).padding).toBe(EXPORT_DEFAULTS.padding);
  });

  it('keeps zero padding rather than mistaking it for absent', () => {
    // The obvious `req.padding || DEFAULT` would silently turn a deliberate 0 into 0.12.
    expect(resolveExportOptions({ format: 'png', padding: 0 }).padding).not.toBe(EXPORT_DEFAULTS.padding);
  });

  it('carries the format through untouched', () => {
    expect(resolveExportOptions({ format: 'svg' }).format).toBe('svg');
  });
});

describe('safeFileName', () => {
  it('slugifies a title into something that survives a filesystem and a URL', () => {
    expect(safeFileName('Where the question goes')).toBe('where-the-question-goes');
    expect(safeFileName('Buy a Journey / v2!')).toBe('buy-a-journey-v2');
    expect(safeFileName('  spaced   out  ')).toBe('spaced-out');
  });

  it('falls back when the input slugifies to nothing', () => {
    expect(safeFileName('///')).toBe(EXPORT_DEFAULTS.fileName);
    expect(safeFileName('')).toBe(EXPORT_DEFAULTS.fileName);
    expect(safeFileName(undefined)).toBe(EXPORT_DEFAULTS.fileName);
  });
});

describe('exportFileName', () => {
  it('names the file after the request, not after a hard-coded "stemma"', () => {
    const o = resolveExportOptions({ format: 'png', fileName: 'Two jobs' });
    expect(exportFileName(o)).toBe('two-jobs.png');
  });

  it('still defaults when no name is given', () => {
    expect(exportFileName(resolveExportOptions({ format: 'svg' }))).toBe('stemma.svg');
  });
});
