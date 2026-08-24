import React from 'react';
import { ImageIcon, MessageSquare, Mic, PenLine, Square, StickyNote, Type } from 'lucide-react';

export const TYPE_ICONS: Record<string, React.ReactNode> = {
  sticky: <StickyNote size={16} color="var(--text-secondary)" />,
  shape: <Square size={16} color="var(--text-secondary)" />,
  text: <Type size={16} color="var(--text-secondary)" />,
  image: <ImageIcon size={16} color="var(--text-secondary)" />,
  audio: <Mic size={16} color="var(--text-secondary)" />,
  path: <PenLine size={16} color="var(--text-secondary)" />,
  comment: <MessageSquare size={16} color="var(--text-secondary)" />,
};
