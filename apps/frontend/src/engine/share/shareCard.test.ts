import { describe, it, expect } from 'vitest';
import { cardPayload, cardSignature, previewsHidden } from './shareCard';
import { badgedFavicon, tabTitle } from '../../hooks/useDocumentHead';

describe('share card payload', () => {
  const preview = { ratio: 2, total: 3, items: [{ x: 0, y: 0, w: 1, h: 1, c: '#000' }], v: 3 };

  it('keeps only what the server stores', () => {
    expect(cardPayload('  Retro  ', preview, false)).toEqual({ name: 'Retro', hidden: false, preview: { ratio: 2, total: 3, items: preview.items } });
  });

  it('sends nothing about a hidden board but that it is hidden', () => {
    expect(cardPayload('Secret plans', preview, true)).toEqual({ name: '', hidden: true, preview: null });
  });

  it('fingerprints payloads so an unchanged board uploads nothing', () => {
    const a = cardSignature(cardPayload('Retro', preview, false));
    expect(cardSignature(cardPayload('Retro', preview, false))).toBe(a);
    expect(cardSignature(cardPayload('Retro 2', preview, false))).not.toBe(a);
    expect(cardSignature(cardPayload('Retro', preview, true))).not.toBe(a);
  });

  it('reads the switch from the board, off only when said so', () => {
    expect(previewsHidden({ sharePreview: 'off' })).toBe(true);
    expect(previewsHidden({ sharePreview: 'on' })).toBe(false);
    expect(previewsHidden({})).toBe(false);
    expect(previewsHidden(undefined)).toBe(false);
  });
});

describe('the tab', () => {
  it('names the board, and counts what is waiting', () => {
    expect(tabTitle('Q3 retro')).toBe('Q3 retro | Vega Studio');
    expect(tabTitle('Q3 retro', 3)).toBe('(3) Q3 retro | Vega Studio');
    expect(tabTitle('Q3 retro', 240)).toBe('(99+) Q3 retro | Vega Studio');
    expect(tabTitle('  ')).toBe('Vega Studio');
  });

  it('adds a badge inside the favicon markup', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect/></svg>\n';
    const badged = badgedFavicon(svg);
    expect(badged.endsWith('</svg>')).toBe(true);
    expect(badged).toContain('<circle');
    expect(badged.indexOf('<circle')).toBeGreaterThan(badged.indexOf('<rect/>'));
  });
});
