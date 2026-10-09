// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LESSONS } from '../../engine/learn/lessons';
import { SCRIPTS, sampleCursor, type ScriptedId } from '../../engine/learn/demoScript';
import { SCENES } from './scenes';
import { ScriptedDemo } from './ScriptedDemo';

const ids = Object.keys(SCRIPTS) as ScriptedId[];

function mockMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => cleanup());

describe('the scenes', () => {
  it('give every scripted demo a scene, and every lesson that names a demo one that draws', () => {
    for (const id of ids) expect(SCENES[id], `no scene for "${id}"`).toBeTypeOf('function');
    for (const lesson of LESSONS) {
      if (!lesson.demo) continue;
      const scripted = ids.includes(lesson.demo as ScriptedId);
      // The older CSS loops are not scripted; everything else must have a script and a scene.
      if (scripted) expect(SCENES[lesson.demo as ScriptedId], lesson.id).toBeDefined();
    }
  });

  it('draw something at every storyboard frame and at the start and end of the film', () => {
    mockMotion(false);
    for (const id of ids) {
      const script = SCRIPTS[id];
      const Scene = SCENES[id];
      for (const t of [0, ...script.frames.map((fr) => fr.at), script.duration]) {
        const cur = sampleCursor(script.cursor, t);
        const { container, unmount } = render(
          <svg>
            <Scene t={t} cur={cur} uid="test" />
          </svg>
        );
        expect(container.querySelector('svg')?.innerHTML.length, `${id} @${t}`).toBeGreaterThan(0);
        // No scene may produce a number the browser cannot draw.
        expect(container.innerHTML, `${id} @${t}`).not.toMatch(/NaN|undefined|Infinity/);
        unmount();
      }
    }
  });

  it('tell each story in three different captions', () => {
    for (const id of ids) {
      const caps = SCRIPTS[id].frames.map((fr) => fr.caption);
      expect(new Set(caps).size, id).toBe(3);
    }
  });
});

describe('reduced motion', () => {
  it('renders a static storyboard of three frames and nothing that plays', () => {
    mockMotion(true);
    for (const id of ids) {
      const { container, unmount } = render(<ScriptedDemo id={id} />);
      expect(container.querySelectorAll('.sd-board__frame'), id).toHaveLength(3);
      expect(container.querySelector('.sd-bar__play'), id).toBeNull();
      expect(container.querySelector('input[type="range"]'), id).toBeNull();
      unmount();
    }
  });

  it('plays, with a pause control, when motion is allowed', () => {
    mockMotion(false);
    const { container } = render(<ScriptedDemo id="share" />);
    expect(container.querySelector('.sd-bar__play')).not.toBeNull();
    expect(container.querySelectorAll('.sd-board__frame')).toHaveLength(0);
  });
});
