// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Template } from '../../engine/templates/templates';

vi.mock('./LiveCover', () => ({ LiveCover: () => null }));

const { TemplateCard } = await import('./TemplateCard');

afterEach(cleanup);

const template = { id: 'systems-x', category: 'systems', name: 'Board X', blurb: 'b', teaches: [], build: () => [] } as Template;

function setup() {
  const onPeek = vi.fn();
  const onUse = vi.fn();
  render(<TemplateCard template={template} peeking={false} scope="all" onPeek={onPeek} onUse={onUse} />);
  return { onPeek, onUse };
}

describe('TemplateCard actions', () => {
  it('Use uses the template once and does not peek', () => {
    const { onPeek, onUse } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Use Board X' }));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith(template);
    expect(onPeek).not.toHaveBeenCalled();
  });

  it('Preview peeks without using', () => {
    const { onPeek, onUse } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Board X' }));
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(onUse).not.toHaveBeenCalled();
  });

  it('Enter uses and Space peeks from the keyboard', () => {
    const { onPeek, onUse } = setup();
    const hit = screen.getByRole('button', { name: 'Board X' });
    fireEvent.keyDown(hit, { key: 'Enter' });
    expect(onUse).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(hit, { key: ' ' });
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledTimes(1);
  });
});

describe('card layering (CSS)', () => {
  /**
   * The name's hit area is stretched over the whole card at z-index 1. The
   * picture gains a stacking context on hover (its lift transform), so unless
   * it sits above that overlay, Preview and Use sit under it while the pointer
   * is on them: a click on Use opened the peek, which re-laid the grid and
   * flickered the hover. jsdom has no layout, so the rule is asserted on the
   * stylesheet itself.
   */
  const css = readFileSync(resolve(__dirname, 'gallery.css'), 'utf8');
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('keeps the picture, and so its buttons, above the hit overlay', () => {
    const art = Number(/z-index:\s*(\d+)/.exec(block('.gcard__art'))?.[1] ?? 0);
    const overlay = Number(/z-index:\s*(\d+)/.exec(block('.gcard__hit::after'))?.[1] ?? 0);
    expect(art).toBeGreaterThan(overlay);
  });

  it('lets a click on the picture itself fall through to the overlay, and the buttons take theirs', () => {
    expect(block('.gcard__art')).toMatch(/pointer-events:\s*none/);
    expect(block('.gcard__actions')).toMatch(/pointer-events:\s*auto/);
  });
});
