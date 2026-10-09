import { describe, expect, it, vi } from 'vitest';

/**
 * Several files from one press of Export: rendered in turn, saved as the file
 * itself when there is one and as one ZIP when there are more, and stopped
 * between files when cancelled.
 */

vi.mock('../../hooks/useStore', () => ({
  useStore: { getState: () => ({ objects: {}, selectedIds: [] }) },
}));

const { ExportService } = await import('./ExportService');
const { ExportRegistry } = await import('./ExportRegistry');

const rendered: string[] = [];
ExportRegistry.register({
  type: 'png',
  export: async (options) => {
    rendered.push(String(options.frameId));
    return new Blob([`png:${options.frameId}`], { type: 'image/png' });
  },
});

function capture() {
  const saved: Array<{ name: string; blob: Blob }> = [];
  ExportService.save = (blob: Blob, name: string) => {
    saved.push({ name, blob });
  };
  return saved;
}

const job = (frameId: string, filename: string) => ({ format: 'png' as const, options: { frameId }, filename });

describe('ExportService.exportFiles', () => {
  it('saves a single file as itself', async () => {
    const saved = capture();
    const result = await ExportService.exportFiles([job('a', 'hero.png')], { archiveName: 'frames' });
    expect(result).toEqual({ files: 1, archive: false });
    expect(saved.map((s) => s.name)).toEqual(['hero.png']);
  });

  it('saves several as one ZIP, with clashing names made distinct', async () => {
    const saved = capture();
    rendered.length = 0;
    const progress: number[] = [];
    const result = await ExportService.exportFiles([job('a', 'frame.png'), job('b', 'frame.png'), job('c', 'cover.png')], {
      archiveName: 'launch-frames',
      onProgress: (p) => progress.push(p.done),
    });
    expect(result).toEqual({ files: 3, archive: true });
    expect(rendered).toEqual(['a', 'b', 'c']);
    expect(progress).toEqual([1, 2, 3]);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('launch-frames.zip');
    const text = new TextDecoder().decode(await saved[0].blob.arrayBuffer());
    expect(text).toContain('frame.png');
    expect(text).toContain('frame-2.png');
    expect(text).toContain('png:b');
  });

  it('stops between files when cancelled, and saves nothing', async () => {
    const saved = capture();
    rendered.length = 0;
    const controller = new AbortController();
    const run = ExportService.exportFiles([job('a', 'a.png'), job('b', 'b.png'), job('c', 'c.png')], {
      archiveName: 'x',
      signal: controller.signal,
      onProgress: (p) => {
        if (p.done === 1) controller.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(rendered).toEqual(['a']);
    expect(saved).toEqual([]);
  });

  it('says what to do when there is nothing to export', async () => {
    await expect(ExportService.exportFiles([], { archiveName: 'x' })).rejects.toThrow(/Select a frame/);
  });
});
