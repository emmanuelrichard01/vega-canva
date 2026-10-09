import React, { useState } from 'react';
import { codeOf, emojiUrl } from '../../engine/emoji/emojiCode';
import './emoji.css';

export interface EmojiProps {
  /** The native glyph. Either this or `code`. */
  native?: string;
  code?: string;
  /** CSS pixels, square. */
  size?: number;
  /** Accessible name. Omit for a decorative emoji beside text that says the same. */
  label?: string;
  className?: string;
  /**
   * `lazy` (the default) for emoji scattered through long content. A
   * virtualised grid passes `eager`: everything it mounts is already in view,
   * and lazy loading would only add a frame of delay before the fetch.
   */
  loading?: 'lazy' | 'eager';
}

/**
 * An emoji in the DOM, drawn from the Fluent set rather than the platform font.
 *
 * Platform emoji differ on every OS and look like clip art beside Inter; one
 * drawn set reads as part of the interface. The `<img>` is lazy and async so a
 * grid of hundreds costs nothing until it scrolls into view, and if the
 * artwork is missing the native glyph is shown in its place rather than a
 * broken image.
 */
export const Emoji: React.FC<EmojiProps> = ({ native, code, size = 20, label, className, loading = 'lazy' }) => {
  const resolved = code ?? (native ? codeOf(native) : '');
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.86) } as React.CSSProperties;
  if (!resolved || failed) {
    return (
      <span className={`emoji emoji--glyph${className ? ` ${className}` : ''}`} style={style} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        {native}
      </span>
    );
  }
  return (
    <img
      className={`emoji${className ? ` ${className}` : ''}`}
      src={emojiUrl(resolved)}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};
