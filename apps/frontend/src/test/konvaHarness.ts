/**
 * Render react-konva trees under jsdom and inspect the Konva nodes they build.
 *
 * jsdom has no 2D canvas, so `getContext('2d')` returns null and Konva cannot
 * construct a layer. This installs a context that accepts every call and
 * remembers nothing. Nothing is painted; what a test can read is the node
 * tree: each node's class, attributes and `listening` flag, which is what a
 * renderer decides and what hit-testing is built from.
 *
 * Use from a test file that starts with `// @vitest-environment jsdom`.
 * Importing this module installs the stub, so Konva nodes built directly in a
 * test work too.
 */
import { createElement, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import Konva from 'konva';
import { Layer, Stage } from 'react-konva';

function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<PropertyKey, unknown> = { canvas };
  const noop = () => undefined;
  const special: Record<string, unknown> = {
    measureText: (text: string) => ({
      width: String(text).length * 7,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 9,
      fontBoundingBoxDescent: 3,
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h) * 4),
    }),
    createImageData: (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h) * 4),
    }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createConicGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({ setTransform: noop }),
    getLineDash: () => [],
    getTransform: () => new DOMMatrixStub(),
    isPointInPath: () => false,
    isPointInStroke: () => false,
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop in special) return special[prop];
      return noop;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

class DOMMatrixStub {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
}

let installed = false;

export function installCanvasStub(): void {
  if (installed) return;
  installed = true;
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = fakeContext(this);
      contexts.set(this, ctx);
    }
    return ctx;
  } as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
}

/** Render `children` inside a Stage and Layer; returns the Konva stage. */
export function renderInStage(children: ReactNode, size = { width: 800, height: 600 }): Konva.Stage {
  installCanvasStub();
  render(createElement(Stage, size, createElement(Layer, null, children)));
  const stage = Konva.stages[Konva.stages.length - 1];
  if (!stage) throw new Error('react-konva did not create a stage');
  return stage;
}

/** Every node of a Konva class under `stage`, in tree order. */
export function nodesOf<T extends Konva.Node = Konva.Node>(stage: Konva.Stage, className: string): T[] {
  return stage.find(className) as unknown as T[];
}

if (typeof HTMLCanvasElement !== 'undefined') installCanvasStub();
