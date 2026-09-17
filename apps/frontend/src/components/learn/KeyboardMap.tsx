import React, { useEffect, useMemo, useState } from 'react';
import { TOOL_SHORTCUTS } from '../../engine/tools/shortcuts';
import { TOOL_NAMES } from '../../engine/tools/toolNames';
import { IS_MAC, SHORTCUTS, SHORTCUT_LABELS, capsFor, type ShortcutId } from '../menu/shortcuts';

/**
 * The keyboard, drawn, with what every key does on it.
 *
 * ## Why a picture of a keyboard
 *
 * A list answers "what is the key for X". It cannot answer the question people
 * arrive at a shortcut page with just as often: *what does this key do*, and
 * *what is left*. Laid out as the keyboard they are looking at, the tools read
 * as a map — V and A beside each other for the two selects, the drawing tools
 * along the top — and an unlabelled key says "nothing here" without a word.
 *
 * ## Layers
 *
 * Figma's shortcut panel shows one layer at a time, and holding a modifier
 * switches to it. The same here: hold Ctrl (⌘ on a Mac), Shift, or Alt and the
 * keys relabel with what that combination does; let go and they come back.
 * The layer buttons do the same for a pointer.
 *
 * ## Where the labels come from
 *
 * Tools from `TOOL_SHORTCUTS` and `TOOL_NAMES`; everything else from
 * `SHORTCUTS`, the table the menus and the rail advertise from. Nothing is
 * written twice, so a key rebound there is redrawn here.
 */

type Layer = '' | 'shift' | 'mod' | 'mod+shift' | 'mod+alt';

interface Binding {
  label: string;
  description: string;
  kind: 'tool' | 'command' | 'view';
}

const ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '/'],
];

/** Row indents, in key widths, as on a real board. */
const INDENT = [0, 0.5, 0.75, 1.25];

/** A word for each tool, sized for a keycap. The long names are the descriptions. */
const TOOL_SHORT: Record<string, string> = {
  select: 'Select',
  'direct-select': 'Direct',
  hand: 'Hand',
  pen: 'Pencil',
  'bezier-pen': 'Pen',
  eraser: 'Eraser',
  text: 'Text',
  shape: 'Shape',
  'shape-line': 'Line',
  frame: 'Frame',
  grid: 'Grid',
  chart: 'Chart',
  connector: 'Connect',
  sticky: 'Note',
  comment: 'Comment',
  image: 'Image',
  audio: 'Voice',
};

/** Single keys that are not tools. Written here because they have no table of their own. */
const VIEW_KEYS: Record<string, Binding> = {
  q: { label: 'Keep', description: 'Keep the armed tool after it places something', kind: 'view' },
  '0': { label: '100%', description: 'Reset the view to the origin at 100%', kind: 'view' },
  '=': { label: 'Zoom in', description: 'Zoom in', kind: 'view' },
  '-': { label: 'Zoom out', description: 'Zoom out', kind: 'view' },
  '\\': { label: 'Focus', description: 'Focus mode: hide or show the panels', kind: 'view' },
};

function buildLayers(): Record<Layer, Map<string, Binding>> {
  const layers: Record<Layer, Map<string, Binding>> = {
    '': new Map(),
    shift: new Map(),
    mod: new Map(),
    'mod+shift': new Map(),
    'mod+alt': new Map(),
  };

  for (const [id, key] of Object.entries(TOOL_SHORTCUTS)) {
    const k = key.toLowerCase();
    if (k.length !== 1) continue;
    const name = TOOL_NAMES[id] ?? id;
    layers[''].set(k, {
      label: TOOL_SHORT[id] ?? name.split(/[:/]/)[0].trim(),
      description: name,
      kind: 'tool',
    });
  }
  for (const [k, binding] of Object.entries(VIEW_KEYS)) {
    if (!layers[''].has(k)) layers[''].set(k, binding);
  }
  layers.shift.set('/', { label: 'Help', description: 'Open this page (?)', kind: 'view' });

  for (const [id, spec] of Object.entries(SHORTCUTS) as Array<[ShortcutId, string]>) {
    const parts = spec.split('+');
    const key = parts.pop()!.toLowerCase();
    if (key.length !== 1) continue;
    const layer = parts.map((p) => p.toLowerCase()).join('+') as Layer;
    if (!(layer in layers)) continue;
    // First writer wins: `Mod+1` fit-all and `Shift+1` fit-all are different layers,
    // but two ids on one key and layer would be a real conflict worth seeing.
    if (!layers[layer].has(key)) {
      layers[layer].set(key, { label: SHORTCUT_LABELS[id], description: SHORTCUT_LABELS[id], kind: 'command' });
    }
  }
  return layers;
}

const LAYERS: Array<{ id: Layer; caps: string }> = [
  { id: '', caps: 'Keys' },
  { id: 'shift', caps: 'Shift' },
  { id: 'mod', caps: 'Mod' },
  { id: 'mod+shift', caps: 'Mod+Shift' },
  { id: 'mod+alt', caps: 'Mod+Alt' },
];

const capLabel = (key: string) => (key === '\\' ? '\\' : key.toUpperCase());

export const KeyboardMap: React.FC = () => {
  const layers = useMemo(buildLayers, []);
  const [chosen, setChosen] = useState<Layer>('');
  const [held, setHeld] = useState<Layer | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const layer = held ?? chosen;
  const bindings = layers[layer];

  /** Holding a modifier shows its layer; releasing returns to the chosen one. */
  useEffect(() => {
    const read = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const next: Layer | null = mod && e.altKey ? 'mod+alt' : mod && e.shiftKey ? 'mod+shift' : mod ? 'mod' : e.shiftKey ? 'shift' : null;
      setHeld(next);
    };
    const clear = () => setHeld(null);
    window.addEventListener('keydown', read);
    window.addEventListener('keyup', read);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', read);
      window.removeEventListener('keyup', read);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const focused = focus ? bindings.get(focus) : null;
  const prefix = LAYERS.find((l) => l.id === layer)!.caps;

  return (
    <div className="kbmap">
      <div className="kbmap__bar">
        <div className="kbmap__layers" role="radiogroup" aria-label="Which keys to show">
          {LAYERS.map((l) => (
            <button
              key={l.id || 'plain'}
              type="button"
              role="radio"
              aria-checked={layer === l.id}
              className="kbmap__layer"
              onClick={() => setChosen(l.id)}
            >
              {l.id === '' ? 'Keys' : capsFor(l.caps).map((c, i) => <kbd key={i}>{c}</kbd>)}
              <span className="kbmap__count">{layers[l.id].size}</span>
            </button>
          ))}
        </div>
        <p className="kbmap__hint">
          Or hold <kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd> <kbd>{IS_MAC ? '⇧' : 'Shift'}</kbd> <kbd>{IS_MAC ? '⌥' : 'Alt'}</kbd>
        </p>
      </div>

      <div className="kbmap__board" role="list" aria-label="Keyboard">
        {ROWS.map((row, r) => (
          <div key={r} className="kbmap__row" style={{ paddingLeft: `calc(${INDENT[r]} * var(--kbmap-key))` }}>
            {row.map((key) => {
              const b = bindings.get(key);
              return (
                <div
                  key={key}
                  role="listitem"
                  tabIndex={b ? 0 : -1}
                  className="kbmap__key"
                  data-kind={b?.kind}
                  data-focused={focus === key || undefined}
                  aria-label={b ? `${layer ? `${prefix} ` : ''}${capLabel(key)}: ${b.description}` : `${capLabel(key)}: nothing`}
                  onPointerEnter={() => setFocus(key)}
                  onPointerLeave={() => setFocus((f) => (f === key ? null : f))}
                  onFocus={() => setFocus(key)}
                  onBlur={() => setFocus((f) => (f === key ? null : f))}
                >
                  <span className="kbmap__cap">{capLabel(key)}</span>
                  {b && <span className="kbmap__label">{b.label}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="kbmap__caption" aria-live="polite">
        {focused && focus ? (
          <>
            <span className="kbmap__caption-keys">
              {capsFor(layer ? `${prefix}+${capLabel(focus)}` : capLabel(focus)).map((c, i) => (
                <kbd key={i}>{c}</kbd>
              ))}
            </span>
            {focused.description}
          </>
        ) : (
          <span className="kbmap__caption-idle">Point at a key to see what it does.</span>
        )}
      </p>
    </div>
  );
};
