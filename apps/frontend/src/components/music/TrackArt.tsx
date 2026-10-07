import React from 'react';
import { CategoryCover } from './CategoryCover';

/** Cover art for a track: its own artwork, or its station's drawn cover; a lettered tile when it has neither. */
export const TrackArt: React.FC<{ artwork: string | null; category: string | null; size: number; className?: string; label?: string }> = ({
  artwork,
  category,
  size,
  className,
  label,
}) =>
  artwork ? (
    <img className={`music-art ${className ?? ''}`} src={artwork} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" />
  ) : category ? (
    <CategoryCover category={category} className={`music-art ${className ?? ''}`} />
  ) : (
    <span className={`music-art music-art--blank ${className ?? ''}`} aria-hidden="true">
      {(label ?? '').slice(0, 1).toUpperCase()}
    </span>
  );
