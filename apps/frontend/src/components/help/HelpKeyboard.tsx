import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IS_MAC, capsFor } from '../menu/shortcuts';
import { MOD_LAYERS, layerOf, type KeyMap, type ModLayer } from './helpContent';

/**
 * The keyboard, drawn, with what every key does on it.
 *
 * A list answers "what is the key for X". The map answers the other question
 * people bring to a shortcut page, "what does this key do", and shows what is
 * still free. Point at or focus a key and the caption lists everything it does
 * on every layer. Hold Ctrl (⌘), Alt (⌥) or Shift, or press the drawn
 * modifiers, and the keycaps relabel for that layer.
 *
 * Nothing is labelled by hand: the labels come from `buildKeyMap`, which reads
 * `TOOL_SHORTCUTS`, the menu table and the reference rows.
 */

type ModName = 'mod' | 'alt' | 'shift';

interface KeyDef {
  /** The key token, as `combosInSpec` and `comboFromEvent` name it. */
  id: string;
  cap: string;
  /** Width in key units. */
  u?: number;
  /** A modifier: pressing it switches the layer. */
  mod?: ModName;
  /** Drawn for the shape of the board, never bound (Caps, Mac's Control). */
  inert?: boolean;
}

const letter = (c: string): KeyDef => ({ id: c, cap: c.toUpperCase() });

const MOD_CAP = IS_MAC ? '⌘' : 'Ctrl';
const ALT_CAP = IS_MAC ? '⌥' : 'Alt';
const SHIFT_CAP = IS_MAC ? '⇧' : 'Shift';

/** Every row is 15 units wide, so the rows line up at both ends. */
export const KEY_ROWS: KeyDef[][] = [
  [
    { id: 'escape', cap: 'Esc', u: 1.5 },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `f${i + 1}`, cap: `F${i + 1}` })),
    { id: 'delete', cap: IS_MAC ? '⌦' : 'Del', u: 1.5 },
  ],
  [
    { id: '`', cap: '`' },
    ...'1234567890'.split('').map(letter),
    { id: '-', cap: '−' },
    { id: '=', cap: '=' },
    { id: 'backspace', cap: IS_MAC ? '⌫' : 'Backspace', u: 2 },
  ],
  [
    { id: 'tab', cap: 'Tab', u: 1.5 },
    ...'qwertyuiop'.split('').map(letter),
    { id: '[', cap: '[' },
    { id: ']', cap: ']' },
    { id: '\\', cap: '\\', u: 1.5 },
  ],
  [
    { id: 'capslock', cap: 'Caps', u: 1.75, inert: true },
    ...'asdfghjkl'.split('').map(letter),
    { id: ';', cap: ';' },
    { id: "'", cap: "'" },
    { id: 'enter', cap: IS_MAC ? 'Return' : 'Enter', u: 2.25 },
  ],
  [
    { id: 'shift-l', cap: SHIFT_CAP, u: 2.25, mod: 'shift' },
    ...'zxcvbnm'.split('').map(letter),
    { id: ',', cap: ',' },
    { id: '.', cap: '.' },
    { id: '/', cap: '/' },
    { id: 'shift-r', cap: SHIFT_CAP, u: 2.75, mod: 'shift' },
  ],
  IS_MAC
    ? [
        { id: 'ctrl', cap: '⌃', u: 1.25, inert: true },
        { id: 'alt-l', cap: ALT_CAP, u: 1.25, mod: 'alt' },
        { id: 'mod-l', cap: MOD_CAP, u: 1.5, mod: 'mod' },
        { id: ' ', cap: '', u: 5.25 },
        { id: 'mod-r', cap: MOD_CAP, u: 1.5, mod: 'mod' },
        { id: 'alt-r', cap: ALT_CAP, u: 1.25, mod: 'alt' },
        { id: 'arrowleft', cap: '←' },
        { id: 'arrowup', cap: '↑' },
        { id: 'arrowright', cap: '→' },
      ]
    : [
        { id: 'mod-l', cap: MOD_CAP, u: 1.5, mod: 'mod' },
        { id: 'alt-l', cap: ALT_CAP, u: 1.25, mod: 'alt' },
        { id: ' ', cap: '', u: 6.5 },
        { id: 'alt-r', cap: ALT_CAP, u: 1.25, mod: 'alt' },
        { id: 'mod-r', cap: MOD_CAP, u: 1.5, mod: 'mod' },
        { id: 'arrowleft', cap: '←' },
        { id: 'arrowup', cap: '↑' },
        { id: 'arrowright', cap: '→' },
      ],
];

/** Every key token the drawing has a place for, so the map knows what it can show. */
export const DRAWN_KEYS: ReadonlySet<string> = new Set(
  KEY_ROWS.flat()
    .filter((k) => !k.mod && !k.inert)
    .map((k) => k.id)
);

const LAYER_WORDS: Record<ModLayer, string> = {
  '': 'Keys',
  shift: 'Shift',
  alt: 'Alt',
  'alt+shift': 'Alt+Shift',
  mod: 'Mod',
  'mod+shift': 'Mod+Shift',
  'mod+alt': 'Mod+Alt',
  'mod+alt+shift': 'Mod+Alt+Shift',
};

function capOf(id: string): string {
  return KEY_ROWS.flat().find((k) => k.id === id)?.cap || (id === ' ' ? 'Space' : id.toUpperCase());
}

/** A key on a layer, as keycaps for this machine. */
export function layerCaps(layer: ModLayer, key?: string): string[] {
  const mods = layer ? capsFor(LAYER_WORDS[layer]) : [];
  return key === undefined ? mods : [...mods, key === ' ' ? 'Space' : capOf(key)];
}

interface Props {
  keymap: KeyMap;
  /** A key to show, from the "press a shortcut" lookup. */
  focus?: { key: string; layer: ModLayer } | null;
}

export const HelpKeyboard: React.FC<Props> = ({ keymap, focus }) => {
  const [chosen, setChosen] = useState<Record<ModName, boolean>>({ mod: false, alt: false, shift: false });
  const [held, setHeld] = useState<ModLayer | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [cursor, setCursor] = useState<[number, number]>([3, 1]);
  const boardRef = useRef<HTMLDivElement>(null);

  const layer: ModLayer = held ?? layerOf(chosen);

  // A key found by pressing it: show its layer and point at it.
  useEffect(() => {
    if (!focus) return;
    const [mod, alt, shift] = ['mod', 'alt', 'shift'].map((m) => focus.layer.split('+').includes(m));
    setChosen({ mod, alt, shift });
    setActive(focus.key);
  }, [focus]);

  // Holding a modifier shows its layer; letting go returns to the chosen one.
  useEffect(() => {
    const read = (e: KeyboardEvent) => {
      const next = layerOf({ mod: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey });
      setHeld(next === '' ? null : next);
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

  /** How many keys do something on each layer, so the empty layers stay out of the way. */
  const counts = useMemo(() => {
    const out = new Map<ModLayer, number>(MOD_LAYERS.map((l) => [l, 0]));
    for (const layers of keymap.values()) for (const [l, list] of layers) if (list.length) out.set(l, (out.get(l) ?? 0) + 1);
    return out;
  }, [keymap]);

  const toggle = (m: ModName) => setChosen((c) => ({ ...c, [m]: !c[m] }));
  const pickLayer = (l: ModLayer) => {
    const parts = l.split('+');
    setChosen({ mod: parts.includes('mod'), alt: parts.includes('alt'), shift: parts.includes('shift') });
  };

  const onBoardKeyDown = (e: React.KeyboardEvent) => {
    const [r, c] = cursor;
    let next: [number, number] | null = null;
    if (e.key === 'ArrowRight') next = [r, Math.min(KEY_ROWS[r].length - 1, c + 1)];
    else if (e.key === 'ArrowLeft') next = [r, Math.max(0, c - 1)];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const nr = Math.min(KEY_ROWS.length - 1, Math.max(0, r + (e.key === 'ArrowDown' ? 1 : -1)));
      // Land on the key under the same point of the row, not the same index.
      const at = KEY_ROWS[r].slice(0, c).reduce((n, k) => n + (k.u ?? 1), 0) + (KEY_ROWS[r][c].u ?? 1) / 2;
      let x = 0;
      let nc = 0;
      for (let i = 0; i < KEY_ROWS[nr].length; i++) {
        const w = KEY_ROWS[nr][i].u ?? 1;
        if (at < x + w) {
          nc = i;
          break;
        }
        x += w;
        nc = i;
      }
      next = [nr, nc];
    } else if (e.key === 'Home') next = [r, 0];
    else if (e.key === 'End') next = [r, KEY_ROWS[r].length - 1];
    // Up and down share a slot: Down from Up, and Up from Down, stay in it.
    const here = KEY_ROWS[r][c]?.id;
    if (here === 'arrowup' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const target = (document.activeElement as HTMLElement | null)?.dataset.pos?.endsWith('d');
      if (e.key === 'ArrowDown' && !target) {
        e.preventDefault();
        e.stopPropagation();
        boardRef.current?.querySelector<HTMLElement>(`[data-pos="${r}-${c}d"]`)?.focus();
        return;
      }
      if (e.key === 'ArrowUp' && target) {
        e.preventDefault();
        e.stopPropagation();
        boardRef.current?.querySelector<HTMLElement>(`[data-pos="${r}-${c}"]`)?.focus();
        return;
      }
    }
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    setCursor(next);
    boardRef.current?.querySelector<HTMLElement>(`[data-pos="${next[0]}-${next[1]}"]`)?.focus();
  };

  const shown = active ? keymap.get(active) : undefined;

  return (
    <div className="hkb">
      <div className="hkb__layers" role="radiogroup" aria-label="Which layer of keys to show">
        {MOD_LAYERS.filter((l) => l === '' || (counts.get(l) ?? 0) > 0).map((l) => (
          <button
            key={l || 'plain'}
            type="button"
            role="radio"
            aria-checked={layer === l}
            className="hkb__layer"
            onClick={() => pickLayer(l)}
          >
            {l === '' ? 'No modifier' : layerCaps(l).map((c, i) => <kbd key={i}>{c}</kbd>)}
            <span className="hkb__count" aria-label={`${counts.get(l)} keys`}>
              {counts.get(l)}
            </span>
          </button>
        ))}
      </div>

      <div className="hkb__board" ref={boardRef} role="group" aria-label="Keyboard" onKeyDown={onBoardKeyDown}>
        {KEY_ROWS.map((row, r) => (
          <div key={r} className={`hkb__row${r === 0 ? ' hkb__row--fn' : ''}`}>
            {row.map((k, c) => {
              const isCursor = cursor[0] === r && cursor[1] === c;
              const pos = `${r}-${c}`;
              if (k.id === 'arrowup') {
                // Up and down share one slot, as on a laptop.
                return (
                  <div key="arrows" className="hkb__stack" style={{ flexGrow: 1 }}>
                    {(['arrowup', 'arrowdown'] as const).map((id) => (
                      <KeyCap
                        key={id}
                        def={{ id, cap: id === 'arrowup' ? '↑' : '↓' }}
                        action={keymap.get(id)?.get(layer)?.[0]}
                        layer={layer}
                        pos={id === 'arrowup' ? pos : `${pos}d`}
                        tabbable={isCursor && id === 'arrowup'}
                        active={active === id}
                        onActivate={setActive}
                        onCursor={() => setCursor([r, c])}
                        half
                      />
                    ))}
                  </div>
                );
              }
              if (k.mod) {
                const on = layer.split('+').includes(k.mod);
                return (
                  <button
                    key={k.id}
                    type="button"
                    className="hkb__key hkb__key--mod"
                    style={{ flexGrow: k.u ?? 1 }}
                    aria-pressed={on}
                    data-pos={pos}
                    tabIndex={isCursor ? 0 : -1}
                    onClick={() => toggle(k.mod!)}
                    onFocus={() => setCursor([r, c])}
                    aria-label={`${capsFor(k.mod === 'mod' ? 'Mod' : k.mod === 'alt' ? 'Alt' : 'Shift')[0]} layer`}
                  >
                    <span className="hkb__cap">{k.cap}</span>
                  </button>
                );
              }
              return (
                <KeyCap
                  key={k.id}
                  def={k}
                  action={k.inert ? undefined : keymap.get(k.id)?.get(layer)?.[0]}
                  layer={layer}
                  pos={pos}
                  tabbable={isCursor}
                  active={active === k.id}
                  onActivate={setActive}
                  onCursor={() => setCursor([r, c])}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="hkb__caption" aria-live="polite">
        {active && shown && shown.size > 0 ? (
          <>
            <p className="hkb__caption-title">
              <kbd>{capOf(active)}</kbd>
              <span>does</span>
            </p>
            <ul className="hkb__caption-list">
              {MOD_LAYERS.filter((l) => shown.get(l)?.length).flatMap((l) =>
                shown.get(l)!.map((a, i) => (
                  <li key={`${l}-${i}`} data-current={l === layer || undefined}>
                    <span className="hkb__caption-keys">
                      {layerCaps(l, active).map((c, j) => (
                        <kbd key={j}>{c}</kbd>
                      ))}
                    </span>
                    <span className="hkb__caption-what">{a.what}</span>
                  </li>
                ))
              )}
            </ul>
          </>
        ) : active ? (
          <p className="hkb__caption-idle">
            <kbd>{capOf(active)}</kbd> is free on every layer.
          </p>
        ) : (
          <p className="hkb__caption-idle">
            Point at a key, or move onto the keyboard with Tab and the arrow keys.
          </p>
        )}
      </div>
    </div>
  );
};

const KeyCap: React.FC<{
  def: KeyDef;
  action?: { label: string; what: string; kind: string };
  layer: ModLayer;
  pos?: string;
  tabbable: boolean;
  active: boolean;
  half?: boolean;
  onActivate: (id: string | null) => void;
  onCursor: () => void;
}> = ({ def, action, layer, pos, tabbable, active, half, onActivate, onCursor }) => {
  const caps = layerCaps(layer, def.id).join(IS_MAC ? '' : '+');
  return (
    <div
      className={`hkb__key${half ? ' hkb__key--half' : ''}`}
      style={half ? undefined : { flexGrow: def.u ?? 1 }}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      data-pos={pos}
      data-bound={action ? true : undefined}
      data-kind={action?.kind}
      data-active={active || undefined}
      aria-label={def.inert ? def.cap : `${caps}: ${action ? action.what : 'nothing on this layer'}`}
      aria-disabled={def.inert || undefined}
      onPointerEnter={() => !def.inert && onActivate(def.id)}
      onFocus={() => {
        onCursor();
        if (!def.inert) onActivate(def.id);
      }}
    >
      <span className="hkb__cap">{def.cap}</span>
      {action && !half && <span className="hkb__label">{action.label}</span>}
    </div>
  );
};
