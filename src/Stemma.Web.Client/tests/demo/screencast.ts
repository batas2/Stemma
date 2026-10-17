import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Records a page through Chrome's own screencast and encodes it with the system ffmpeg.
 *
 * Playwright's `video` option does the same with an ffmpeg build of its own, which it does not
 * publish for every distribution it otherwise runs on. Chrome sends a frame only when the page
 * repaints, so each frame is held until the next one arrives: a still caption costs one frame, and
 * the result plays at the speed it was recorded.
 */
export async function screencast(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const frames: { data: Buffer; at: number }[] = [];
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push({ data: Buffer.from(frame.data, 'base64'), at: frame.metadata.timestamp ?? Date.now() / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => { /* page closing */ });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 720 });

  /** Stop, and write `<base>.mp4` (H.264, for the web) and `<base>.webm` (VP9). */
  return async (base: string) => {
    const end = Date.now() / 1000;
    await cdp.send('Page.stopScreencast').catch(() => { /* already gone */ });
    if (frames.length === 0) throw new Error('the screencast recorded no frames');

    const dir = await mkdtemp(join(tmpdir(), 'stemma-screencast-'));
    try {
      const list: string[] = [];
      for (let i = 0; i < frames.length; i++) {
        const file = join(dir, `${String(i).padStart(5, '0')}.jpg`);
        await writeFile(file, frames[i].data);
        const next = i + 1 < frames.length ? frames[i + 1].at : end;
        list.push(`file '${file}'`, `duration ${Math.max(0.001, next - frames[i].at).toFixed(3)}`);
      }
      // The concat demuxer ignores the last entry's duration unless the file is named again.
      list.push(`file '${join(dir, `${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
      const listFile = join(dir, 'frames.txt');
      await writeFile(listFile, list.join('\n') + '\n');

      await mkdir(join(base, '..'), { recursive: true });
      const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,format=yuv420p'];
      execFileSync('ffmpeg', [...input, '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', `${base}.mp4`]);
      execFileSync('ffmpeg', [...input, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', `${base}.webm`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
