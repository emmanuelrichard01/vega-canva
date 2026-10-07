// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import { renderHook, cleanup } from '@testing-library/react';
import { useCanvasSelection } from './useCanvasSelection';
import { useStore } from './useStore';

const box = (id: string, x: number, y: number, width: number, height: number, rotation = 0) =>
  ({ id, type: 'shape', x, y, width, height, rotation, scaleX: 1, scaleY: 1, locked: false }) as any;

function fire(target: EventTarget, type: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

describe('useCanvasSelection', () => {
  let setSelectedIds: ReturnType<typeof vi.fn<(next: React.SetStateAction<string[]>) => void>>;
  /** What the selection is after every update, functional or not. */
  let selection: string[];

  beforeEach(() => {
    selection = [];
    setSelectedIds = vi.fn<(next: React.SetStateAction<string[]>) => void>((next) => {
      selection = typeof next === 'function' ? next(selection) : next;
    });
    useStore.setState({
      objects: {
        node1: box('node1', 10, 10, 50, 50),
        node2: box('node2', 200, 200, 50, 50),
      },
      groups: {},
    });
  });

  afterEach(() => cleanup());

  const mount = () =>
    renderHook(() => useCanvasSelection({ activeTool: 'select', selectedIds: [], setSelectedIds }));

  it('selects intersecting objects on marqueeSelect', () => {
    mount();
    fire(document, 'marqueeSelect', { minX: 0, minY: 0, maxX: 100, maxY: 100, additive: false });
    expect(selection).toEqual(['node1']);
  });

  it('judges a rotated object by its outline as drawn', () => {
    // A 200x20 bar centred on (100, 10), turned on end: it now spans y -90..110
    // at x 90..110, so a marquee above its flat position catches it and one
    // beside the flat bar's right end does not.
    useStore.setState({ objects: { bar: box('bar', 0, 0, 200, 20, 90) } });
    mount();
    fire(document, 'marqueeSelect', { minX: 95, minY: -80, maxX: 105, maxY: -60 });
    expect(selection).toEqual(['bar']);
    fire(document, 'marqueeSelect', { minX: 180, minY: 0, maxX: 199, maxY: 19 });
    expect(selection).toEqual([]);
  });

  it('selects a single object on requestSelectNode', () => {
    mount();
    fire(document, 'requestSelectNode', { id: 'node2' });
    expect(setSelectedIds).toHaveBeenCalledWith(['node2']);
  });

  it('clears the selection when requestSelectNode has no id', () => {
    mount();
    fire(document, 'requestSelectNode', {});
    expect(setSelectedIds).toHaveBeenCalledWith([]);
  });

  it('stops listening once unmounted', () => {
    const { unmount } = mount();
    unmount();
    fire(document, 'requestSelectNode', { id: 'node2' });
    expect(setSelectedIds).not.toHaveBeenCalled();
  });

  it('subtracts and intersects by marquee mode', () => {
    mount();
    selection = ['node1', 'node2'];
    fire(document, 'marqueeSelect', { minX: 0, minY: 0, maxX: 100, maxY: 100, mode: 'subtract' });
    expect(selection).toEqual(['node2']);
    selection = ['node1', 'node2'];
    fire(document, 'marqueeSelect', { minX: 0, minY: 0, maxX: 100, maxY: 100, mode: 'intersect' });
    expect(selection).toEqual(['node1']);
  });

  it('catches a whole group when the marquee touches one member', () => {
    useStore.setState({
      objects: {
        a: { ...box('a', 0, 0, 10, 10), parentId: 'g' },
        b: { ...box('b', 500, 500, 10, 10), parentId: 'g' },
        c: box('c', 900, 900, 10, 10),
      },
      groups: { g: { id: 'g' } },
    });
    mount();
    fire(document, 'marqueeSelect', { minX: -5, minY: -5, maxX: 20, maxY: 20 });
    expect(selection.sort()).toEqual(['a', 'b']);
  });

  it('deep-selects through groups with the deep modifier, and toggles with Shift added', () => {
    useStore.setState({
      objects: {
        a: { ...box('a', 0, 0, 10, 10), parentId: 'g' },
        b: { ...box('b', 50, 0, 10, 10), parentId: 'g' },
      },
      groups: { g: { id: 'g' } },
    });
    const { result } = mount();
    result.current.handleObjectSelect('a', { evt: {} });
    expect(selection.sort()).toEqual(['a', 'b']);
    result.current.handleObjectSelect('a', { evt: { ctrlKey: true } });
    expect(selection).toEqual(['a']);
    result.current.handleObjectSelect('b', { evt: { ctrlKey: true, shiftKey: true } });
    expect(selection).toEqual(['a', 'b']);
    result.current.handleObjectSelect('a', { evt: { ctrlKey: true, shiftKey: true } });
    expect(selection).toEqual(['b']);
  });

  it('keeps a selection whole when Ctrl is pressed on a member, so Ctrl+drag moves all of it', () => {
    useStore.setState({
      objects: {
        a: { ...box('a', 0, 0, 10, 10), parentId: 'g' },
        b: { ...box('b', 50, 0, 10, 10), parentId: 'g' },
      },
      groups: { g: { id: 'g' } },
    });
    const { result } = mount();
    result.current.handleObjectSelect('a', { evt: {} });
    result.current.handleObjectSelect('a', { evt: { ctrlKey: true, type: 'mousedown' } });
    expect(selection.sort()).toEqual(['a', 'b']);
    // Released without a drag, it is a click, and narrows to the object.
    result.current.handleObjectSelect('a', { evt: { ctrlKey: true, type: 'click' } });
    expect(selection).toEqual(['a']);
  });

  it('selects every object with the same fill on requestSelectSimilar', () => {
    const paint = (color: string) => ({ appearance: { fill: [{ type: 'solid', color }] } });
    useStore.setState({
      objects: {
        a: { ...box('a', 0, 0, 10, 10), ...paint('#111111') },
        b: { ...box('b', 50, 0, 10, 10), ...paint('#111111') },
        c: { ...box('c', 90, 0, 10, 10), ...paint('#222222') },
      },
      groups: {},
    });
    mount();
    selection = ['a'];
    window.dispatchEvent(new CustomEvent('requestSelectSimilar', { detail: { key: 'fill' } }));
    expect(selection).toEqual(['a', 'b']);
  });
});
