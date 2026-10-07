import React from 'react';
import { initialsFor } from '../../engine/presence/collaborators';
import { chipColorsFor } from '../../engine/cursor/remoteCursor';
import './avatar.css';

interface Props {
  name: string;
  color: string;
  size: number;
  title?: string;
  className?: string;
  /** A ring in their colour, for someone who is here right now. */
  ring?: boolean;
  /** Marks your own avatar, so you can find yourself in a stack. */
  you?: boolean;
}

/**
 * A person, as their initials on their colour.
 *
 * The fill and the initials' ink come from `chipColorsFor`, the same pair the
 * cursor tag uses, so a yellow or lime identity colour gets dark initials
 * instead of white ones that disappear. The text size tracks the disc, so two
 * letters fit a 20px comment pin as well as a 96px profile.
 */
export const Avatar: React.FC<Props> = ({ name, color, size, title, className, ring, you }) => {
  const { fill, ink, outline } = chipColorsFor(color);
  return (
    <span
      className={['avatar', className].filter(Boolean).join(' ')}
      data-ring={ring ? '1' : undefined}
      data-you={you ? '1' : undefined}
      style={
        {
          '--avatar-size': `${size}px`,
          '--avatar-fill': fill,
          '--avatar-ink': ink,
          '--avatar-ring': outline,
          fontSize: Math.round(size * 0.4),
          letterSpacing: size < 28 ? '-0.02em' : 0,
        } as React.CSSProperties
      }
      title={title ?? (you ? `${name} (you)` : name)}
    >
      {initialsFor(name)}
    </span>
  );
};

interface StackPerson {
  key: string | number;
  name: string;
  color: string;
  you?: boolean;
  title?: string;
}

/**
 * Overlapping avatars with an overflow count, as in the header and on board
 * cards. Each disc is cut out of the one beside it by a ring in the surface
 * colour, so the stack reads as separate people at any size.
 */
export const AvatarStack: React.FC<{
  people: StackPerson[];
  size: number;
  max?: number;
  ring?: boolean;
  className?: string;
}> = ({ people, size, max = 3, ring, className }) => {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span
      className={['avatar-stack', className].filter(Boolean).join(' ')}
      style={{ '--avatar-size': `${size}px` } as React.CSSProperties}
    >
      {shown.map((p) => (
        <Avatar key={p.key} name={p.name} color={p.color} size={size} ring={ring} you={p.you} title={p.title} />
      ))}
      {extra > 0 && (
        <span
          className="avatar avatar--more"
          style={{ fontSize: Math.round(size * 0.38) } as React.CSSProperties}
          title={people
            .slice(max)
            .map((p) => p.name)
            .join(', ')}
        >
          +{extra}
        </span>
      )}
    </span>
  );
};
