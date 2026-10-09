import { describe, expect, it } from 'vitest';
import { armedOnBar, isPhoneToolActive, phonePrimary, PHONE_TOOL_GROUPS, PHONE_TOOLS } from './phoneToolModel';

describe('phone tool bar', () => {
  it('has six seats: select, draw, note, shape, text, connector', () => {
    expect(phonePrimary('select').map((t) => t.id)).toEqual(['select', 'draw', 'sticky', 'shape', 'text', 'connector']);
  });

  it('wears Hand in the draw seat while Hand is armed', () => {
    expect(phonePrimary('hand')[1].id).toBe('hand');
    expect(phonePrimary('pen')[1].id).toBe('draw');
  });

  it('lights a seat for its whole family', () => {
    const [select, draw, , shape] = phonePrimary('select');
    expect(isPhoneToolActive(select, 'direct-select', { seat: true })).toBe(true);
    expect(isPhoneToolActive(draw, 'eraser', { seat: true })).toBe(true);
    expect(isPhoneToolActive(shape, 'shape-ellipse', { seat: true })).toBe(true);
    expect(isPhoneToolActive(shape, 'shape-arrow', { seat: true })).toBe(false);
  });

  it('tells the three pens apart in More by brush', () => {
    expect(isPhoneToolActive(PHONE_TOOLS.marker, 'pen', { brush: 'marker' })).toBe(true);
    expect(isPhoneToolActive(PHONE_TOOLS.pen, 'pen', { brush: 'marker' })).toBe(false);
    expect(isPhoneToolActive(PHONE_TOOLS.select, 'direct-select')).toBe(false);
  });

  it('marks More as armed only for a tool with no seat', () => {
    expect(armedOnBar('sticky')).toBe(true);
    expect(armedOnBar('hand')).toBe(true);
    expect(armedOnBar('table')).toBe(false);
    expect(armedOnBar('frame-a4')).toBe(false);
  });

  it('lists every tool once in More, the six included', () => {
    const ids = PHONE_TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const seat of ['select', 'sticky', 'shape', 'text', 'connector', 'hand', 'pen']) expect(ids).toContain(seat);
  });
});
