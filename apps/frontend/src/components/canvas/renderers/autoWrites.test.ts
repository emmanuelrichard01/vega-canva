import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Automatic box write-backs are bookkeeping: they go out under the derived
 * origin, which the undo manager ignores, and only from the elected editor, so
 * a viewer never writes and peers never write twice. Asserted on the source
 * because the renderers need a Konva stage to mount.
 */
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

describe.each(['TextRenderer.tsx', 'ConnectorRenderer.tsx'])('%s automatic writes', (file) => {
  const src = read(file);

  it('are scheduled under the derived origin, outside undo', () => {
    expect(src).not.toMatch(/origin:\s*null/);
    expect(src).toContain('scheduleDerivedPatch(');
  });

  it('come only from the elected writer', () => {
    expect(src).toContain('isElectedWriter()');
  });
});
