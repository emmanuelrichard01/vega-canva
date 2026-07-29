import React, { useEffect, useState } from 'react';
import { Edit3, Image as ImageIcon, MessageSquare, Mic, PenLine, Plus, Trash2 } from 'lucide-react';
import { historyService, type CanvasCommand } from '../engine/services/HistoryService';

/** How long an event stays on screen. */
const EVENT_TTL_MS = 4500;
const MAX_VISIBLE = 4;

interface FeedItem {
  id: string;
  timestamp: number;
  userName: string;
  userColor: string;
  icon: React.ReactNode;
  message: string;
}

const NODE_LABELS: Record<string, string> = {
  shape: 'a shape',
  text: 'text',
  sticky: 'a sticky note',
  image: 'an image',
  audio: 'a voice note',
  path: 'a drawing',
  comment: 'a comment',
  frame: 'a frame',
};

function iconFor(command: CanvasCommand): React.ReactNode {
  const type = (command.payload as { type?: string } | undefined)?.type;
  if (command.type === 'Delete Node') return <Trash2 size={13} color="#F87171" />;
  if (command.type === 'Create Node') {
    switch (type) {
      case 'audio': return <Mic size={13} color="#EF4444" />;
      case 'image': return <ImageIcon size={13} color="#FBBF24" />;
      case 'comment': return <MessageSquare size={13} color="#818CF8" />;
      case 'path': return <PenLine size={13} color="#34D399" />;
      default: return <Plus size={13} color="#F59E0B" />;
    }
  }
  return <Edit3 size={13} color="#60A5FA" />;
}

function messageFor(command: CanvasCommand): string {
  const type = (command.payload as { type?: string } | undefined)?.type;
  switch (command.type) {
    case 'Create Node': return `added ${NODE_LABELS[type ?? ''] ?? 'an object'}`;
    case 'Delete Node': return 'deleted an object';
    default: return 'made an edit';
  }
}

/**
 * Ambient feed of what collaborators are doing.
 *
 * This component existed but was fed from a local `activityEvents` array in
 * Room.tsx whose only producer had been commented out — so it never rendered
 * anything. Meanwhile the command layer was writing a full authoring log into
 * the shared document that nothing read. Connecting the two makes the log
 * earn its keep and gives the feed a real source.
 *
 * Only *remote* activity is shown: narrating your own actions back at you is
 * noise, not presence.
 */
export const ActivityFeed: React.FC = () => {
  const [items, setItems] = useState<FeedItem[]>([]);

  useEffect(() => {
    const localId = historyService.localClientId;

    const unsubscribe = historyService.subscribe((events) => {
      const now = Date.now();
      const fresh = events
        .filter((e) => e.userId !== localId && now - e.timestamp < EVENT_TTL_MS)
        .slice(-MAX_VISIBLE)
        .map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          userName: e.userName,
          userColor: e.userColor,
          icon: iconFor(e),
          message: messageFor(e),
        }));
      setItems(fresh);
    });

    const expiry = setInterval(() => {
      const now = Date.now();
      setItems((prev) => {
        const next = prev.filter((i) => now - i.timestamp < EVENT_TTL_MS);
        return next.length === prev.length ? prev : next;
      });
    }, 700);

    return () => {
      unsubscribe();
      clearInterval(expiry);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute', bottom: 200, left: 24, zIndex: 90,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',
      }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            background: 'var(--surface-inverse)',
            border: '1px solid var(--border-inverse)',
            borderRadius: 20,
            padding: '6px 14px',
            color: 'var(--text-inverse)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: 'var(--shadow-lg)',
            animation: 'fadeIn 0.25s ease-out',
          }}
        >
          {item.icon}
          <span style={{ fontWeight: 600, color: item.userColor }}>{item.userName}</span>
          <span style={{ opacity: 0.85 }}>{item.message}</span>
        </div>
      ))}
    </div>
  );
};
