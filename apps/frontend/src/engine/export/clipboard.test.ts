import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCopyImage, copyImage, copyVector } from './clipboard';

const g = globalThis as Record<string, unknown> & {
  navigator?: { clipboard?: unknown };
  ClipboardItem?: unknown;
};

const original = { navigator: g.navigator, ClipboardItem: g.ClipboardItem };

/** What the fake `ClipboardItem` constructor produces. */
interface FakeItem { data: Record<string, unknown> }

function install(options: {
  write?: (items: FakeItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
  item?: boolean;
}) {
  const clipboard: Record<string, unknown> = {};
  if (options.write) clipboard.write = options.write;
  if (options.writeText) clipboard.writeText = options.writeText;
  Object.defineProperty(g, 'navigator', { value: { clipboard }, configurable: true, writable: true });
  Object.defineProperty(g, 'ClipboardItem', {
    // The real constructor stores the record; the tests only read it back.
    // Written out rather than as a parameter property: this project builds
    // with `erasableSyntaxOnly`, which rules out the shorthand.
    value: options.item === false ? undefined : class FakeClipboardItem {
      data: Record<string, unknown>;
      constructor(data: Record<string, unknown>) { this.data = data; }
    },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(g, 'navigator', { value: original.navigator, configurable: true, writable: true });
  Object.defineProperty(g, 'ClipboardItem', { value: original.ClipboardItem, configurable: true, writable: true });
});

describe('copyImage', () => {
  it('hands over the render as a promise rather than awaiting it first', async () => {
    /**
     * Safari ties a clipboard write to the gesture that started it, and an
     * `await` before `clipboard.write` ends that gesture -- so rendering the
     * PNG and then writing it failed there with a bare NotAllowedError while
     * working perfectly in Chrome.
     */
    let resolved = false;
    const write = vi.fn(async (_items: FakeItem[]) => {});
    install({ write });
    await copyImage(async () => { resolved = true; return new Blob(); });
    const item = write.mock.calls[0]![0]![0]!;
    expect(item.data['image/png']).toBeInstanceOf(Promise);
    expect(resolved).toBe(true);
  });

  it('says so when the browser has no ClipboardItem at all', async () => {
    // Every Firefox before 127.
    install({ write: async () => {}, item: false });
    const result = await copyImage(async () => new Blob());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Export/);
  });

  it('turns a denied permission into an instruction rather than an error name', async () => {
    const denied = new Error('');
    denied.name = 'NotAllowedError';
    install({ write: async () => { throw denied; } });
    const result = await copyImage(async () => new Blob());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/blocked the clipboard/);
  });

  it('reports a render that threw, in the render\'s own words', async () => {
    install({ write: async (items) => { await (items[0]!.data['image/png'] as Promise<Blob>); } });
    const result = await copyImage(async () => { throw new Error('Raster export needs a Konva stage.'); });
    expect(result).toEqual({ ok: false, message: 'Raster export needs a Konva stage.' });
  });

  it('never throws, so a menu item cannot fail into an unhandled rejection', async () => {
    install({ write: async () => { throw new Error('boom'); } });
    await expect(copyImage(async () => new Blob())).resolves.toMatchObject({ ok: false });
  });
});

describe('copyVector', () => {
  it('offers the vector and the text in one item', async () => {
    /**
     * A target that understands `image/svg+xml` takes shapes; one that does not
     * takes the markup. Pasting into Illustrator and pasting into a text editor
     * are both the right answer, from one write.
     */
    const write = vi.fn(async (_items: FakeItem[]) => {});
    install({ write, writeText: async () => {} });
    await copyVector('<svg/>');
    const item = write.mock.calls[0]![0]![0]!;
    expect(Object.keys(item.data)).toEqual(['image/svg+xml', 'text/plain']);
  });

  it('falls back to plain text when the browser refuses the vector type', async () => {
    // An unsupported type rejects the *whole* write, so this cannot be left to
    // chance -- the fallback is the flavour every target accepts.
    const writeText = vi.fn(async () => {});
    install({ write: async () => { throw new Error('type not supported'); }, writeText });
    const result = await copyVector('<svg/>');
    expect(result.ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('<svg/>');
  });

  it('reports a refusal that reaches the text path too', async () => {
    const denied = new Error('');
    denied.name = 'NotAllowedError';
    install({ write: async () => { throw denied; }, writeText: async () => { throw denied; } });
    expect((await copyVector('<svg/>')).ok).toBe(false);
  });

  it('works on a browser with writeText and nothing else', async () => {
    const writeText = vi.fn(async () => {});
    install({ writeText, item: false });
    expect(canCopyImage()).toBe(false);
    expect((await copyVector('<svg/>')).ok).toBe(true);
    expect(writeText).toHaveBeenCalled();
  });
});
