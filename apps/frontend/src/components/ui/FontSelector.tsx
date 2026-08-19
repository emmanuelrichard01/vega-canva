import React from 'react';

/**
 * The typefaces a text object can be set in.
 *
 * ## Every name here is loaded
 *
 * This list used to carry Roboto, Space Grotesk and Outfit while `index.css`
 * imported only Inter — so choosing one silently fell back to whatever the
 * operating system happened to have, and the picker reported a typeface the
 * canvas was not drawing. They are all imported now, and this list and those
 * imports are the two halves of one fact: add a face to one, add it to the
 * other.
 *
 * ## Why the handwritten faces are real fonts
 *
 * A handwritten look could in principle be made by running each glyph's
 * outline through the same sketcher that roughens shapes. It would be worse in
 * every way that matters: it has to re-roughen every character on every
 * keystroke, it cannot be exported as text, and it would still be an
 * *impression* of handwriting drawn by an algorithm that has never seen a pen.
 * A hand-drawn typeface was drawn by hand, which is the thing being asked for.
 *
 * Caveat is the natural, flowing one; Architects Daughter is the upright
 * drafting hand a diagram wants.
 */
const GROUPS: Array<{ label: string; fonts: string[] }> = [
  { label: 'Sans', fonts: ['Inter', 'Roboto', 'Space Grotesk', 'Outfit'] },
  { label: 'Handwritten', fonts: ['Caveat', 'Architects Daughter'] },
  { label: 'Serif & mono', fonts: ['Georgia', 'Courier New'] },
];

interface Props {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}

export const FontSelector: React.FC<Props> = ({ value, onChange, className = '' }) => {
  return (
    <div className={className} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Font"
        style={{
          appearance: 'none', background: 'var(--surface-hover)',
          border: '1px solid transparent', borderRadius: '6px',
          padding: '4px 24px 4px 12px', fontSize: '12px', fontWeight: 500,
          color: 'var(--text-primary)', outline: 'none', cursor: 'pointer',
          // The control is set in the face it names, so the choice is legible
          // before it is made rather than after.
          fontFamily: value,
        }}
      >
        {GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.fonts.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <div style={{ position: 'absolute', right: '8px', pointerEvents: 'none', color: 'var(--text-secondary)' }}>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
};
