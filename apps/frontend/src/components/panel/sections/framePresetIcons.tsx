import React from 'react';
import {
  FileText,
  GalleryVerticalEnd,
  IdCard,
  Laptop,
  Link2,
  Monitor,
  MonitorPlay,
  Presentation,
  RectangleVertical,
  Smartphone,
  Square,
  Tablet,
} from 'lucide-react';
import type { FramePresetIcon as IconId } from '../../../engine/model/frames';

const ICONS: Record<IconId, React.FC<{ size?: number }>> = {
  desktop: Monitor,
  laptop: Laptop,
  tablet: Tablet,
  phone: Smartphone,
  slide: Presentation,
  square: Square,
  portrait: RectangleVertical,
  story: GalleryVerticalEnd,
  video: MonitorPlay,
  link: Link2,
  page: FileText,
  card: IdCard,
};

/** The glyph for a frame preset, in the panel's, rail's and dock's one icon set. */
export const FramePresetIcon: React.FC<{ icon: IconId; size?: number }> = ({ icon, size = 14 }) => {
  const Glyph = ICONS[icon] ?? Square;
  return <Glyph size={size} aria-hidden="true" />;
};
