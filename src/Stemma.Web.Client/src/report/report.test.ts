import { describe, it, expect } from 'vitest';
import { buildReportBundle, type ReportInputs } from './reportData';
import { renderReportHtml } from './template';
import { mergeCommentPack, parseCommentPack, type CommentsSidecar } from '@/lib/comments';
import type { ArchModel } from '@/lib/types';

const model: ArchModel = {
  filePath: '/ws/Architecture/Architecture.cs',
  elements: [
    { id: 'mod_a', name: 'Alpha', kind: 'module', attributes: {} },
    { id: 'mod_b', name: 'Beta </script> "quotes"', kind: 'module', attributes: { contextId: 'bc_1' } },
    { id: 'bc_1', name: 'Core', kind: 'boundedContext', attributes: {} },
  ],
  links: [
    { id: 'dep_1', fromId: 'mod_a', toId: 'mod_b', kind: 'dependency', attributes: { kind: 'uses' } },
  ],
  tags: [],
};

function inputs(): ReportInputs {
  return {
    rootPath: '/ws',
    workspaceName: 'ws',
    model,
    customViews: [{ id: 'cv1', name: 'Focus', baseView: 'all', elementIds: ['mod_a'], createdAt: '2026-06-01T00:00:00Z' }],
    comments: [],
    readPositions: (k) => (k === 'moduleMap' ? { mod_a: { x: 0, y: 0 } } : {}) as Record<string, { x: number; y: number }>,
    readWaypoints: () => ({}),
    readHandles: () => ({}),
    nodeStyles: {},
    edgeStyles: {},
    notes: { mod_a: 'note text' },
    customProps: {},
    now: new Date('2026-06-10T12:00:00Z'),
  };
}

describe('report bundle', () => {
  it('includes built-in views plus saved views with their layouts', () => {
    const b = buildReportBundle(inputs());
    expect(b.views.map((v) => v.key)).toEqual(['moduleMap', 'dependencyGraph', 'custom:cv1']);
    expect(b.views[2].elementIds).toEqual(['mod_a']);
    expect(b.positions.moduleMap.mod_a).toEqual({ x: 0, y: 0 });
    expect(b.meta.exportedAt).toBe('2026-06-10T12:00:00.000Z');
  });
});

describe('report html (single-file invariants)', () => {
  const html = renderReportHtml(buildReportBundle(inputs()), 'console.log("viewer")', '.vr-app{}');

  it('embeds the data without an early </script> terminator', () => {
    expect(html).toContain('stemma-report-data');
    // The element name contains a literal </script>; it must be escaped in the JSON block.
    const dataBlock = html.split('id="stemma-report-data">')[1].split('</script>')[0];
    expect(dataBlock).toContain('\\u003c/script>');
    expect(JSON.parse(dataBlock).model.elements[1].name).toBe('Beta </script> "quotes"');
  });

  it('makes no external requests', () => {
    expect(html).not.toMatch(/src="http/);
    expect(html).not.toMatch(/href="http/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/url\(http/);
  });

  it('inlines viewer js and css', () => {
    expect(html).toContain('console.log("viewer")');
    expect(html).toContain('.vr-app{}');
    expect(html).toContain('<title>ws — Architecture Report</title>');
  });
});

describe('comment pack merge', () => {
  const sidecar: CommentsSidecar = {
    version: 1,
    comments: [{
      id: 'c_1', targetKind: 'element', targetId: 'mod_a', author: 'aria',
      createdAt: '2026-06-01T00:00:00Z', body: 'existing', resolved: true,
      thread: [{ author: 'sam', createdAt: '2026-06-02T00:00:00Z', body: 'reply' }],
    }],
  };

  it('adds new comments and keeps existing ones', () => {
    const pack = parseCommentPack(JSON.stringify({
      version: 1, author: 'priya',
      comments: [{ id: 'c_2', targetKind: 'element', targetId: 'mod_b', author: '', createdAt: '', body: 'challenge', resolved: false, thread: [] }],
    }));
    const { merged, added, repliesAdded } = mergeCommentPack(sidecar, pack);
    expect(added).toBe(1);
    expect(repliesAdded).toBe(0);
    expect(merged.comments).toHaveLength(2);
    const fresh = merged.comments.find((c) => c.id === 'c_2')!;
    expect(fresh.author).toBe('priya');       // pack author backfills missing author
    expect(fresh.resolved).toBe(false);
  });

  it('appends unseen thread replies, keeps local resolved flag, and is idempotent', () => {
    const pack = parseCommentPack(JSON.stringify({
      version: 1,
      comments: [{
        id: 'c_1', targetKind: 'element', targetId: 'mod_a', author: 'aria',
        createdAt: '2026-06-01T00:00:00Z', body: 'existing', resolved: false,
        thread: [
          { author: 'sam', createdAt: '2026-06-02T00:00:00Z', body: 'reply' },          // duplicate
          { author: 'devin', createdAt: '2026-06-03T00:00:00Z', body: 'new reply' },    // new
        ],
      }],
    }));
    const once = mergeCommentPack(sidecar, pack);
    expect(once.added).toBe(0);
    expect(once.repliesAdded).toBe(1);
    expect(once.merged.comments[0].thread).toHaveLength(2);
    expect(once.merged.comments[0].resolved).toBe(true); // local flag wins

    const twice = mergeCommentPack(once.merged, pack);
    expect(twice.added).toBe(0);
    expect(twice.repliesAdded).toBe(0);
  });

  it('rejects garbage', () => {
    expect(() => parseCommentPack('{"nope":true}')).toThrow();
    expect(() => parseCommentPack(JSON.stringify({ comments: [{ id: 'x' }] }))).toThrow();
  });
});
