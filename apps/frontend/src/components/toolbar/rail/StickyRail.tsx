import React from 'react';
import { motion } from 'framer-motion';
import { Pin, SmilePlus } from 'lucide-react';
import { localAuthorId, toggleReaction } from '../../../engine/document';
import type { StickyNode, StickyTheme } from '../../../engine/model/schema';
import { useStore } from '../../../hooks/useStore';
import { RailButton } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { StickyPalette } from '../StickyToolbar';
import { RailAnatomy } from './anatomy';
import { updateNode, type SingleRail } from './types';

/** Reactions worth one press while brainstorming. */
const REACTION_SET = ['👍', '❤️', '🎉', '🔥', '🚀', '👀', '💡', '💯'];

/**
 * A sticky note: its paper, whether it is pinned, and a reaction.
 *
 * The paper is a closed set of eight themes, offered as themselves rather than
 * through a colour picker that would snap every pick to one of them.
 */
export const StickyRail: SingleRail<StickyNode> = ({ node, conditional, tail, tailControls }) => {
  const me = localAuthorId();
  return (
    <RailAnatomy
      paint={
        <StickyPalette
          theme={node.theme}
          onPick={(theme: StickyTheme) => {
            updateNode(node.id, { theme });
            // Recolouring a note also sets what the next one will be.
            useStore.getState().setStickyTheme(theme);
          }}
        />
      }
      paintControls={1}
      verbs={[
        {
          id: 'pin',
          controls: 1,
          node: (
            <RailButton
              label={node.pinned ? 'Unpin' : 'Pin'}
              pressed={node.pinned}
              onClick={() => updateNode(node.id, { pinned: !node.pinned })}
            >
              <Pin size={16} fill={node.pinned ? 'currentColor' : 'none'} />
            </RailButton>
          ),
        },
        {
          id: 'react',
          controls: 1,
          node: (
            <RailPopover label="React" align="center" trigger={<SmilePlus size={16} />}>
              {(close) => (
                <div className="rail-reactions">
                  {REACTION_SET.map((emoji) => {
                    const mine = (node.reactions[emoji] ?? []).includes(me);
                    return (
                      <motion.button
                        key={emoji}
                        type="button"
                        whileHover={{ scale: 1.2, y: -2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => {
                          toggleReaction(node.id, emoji, me);
                          close();
                        }}
                        aria-pressed={mine}
                        aria-label={mine ? `Remove ${emoji}` : `React ${emoji}`}
                        className="ctx-reaction"
                        data-mine={mine || undefined}
                      >
                        {emoji}
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </RailPopover>
          ),
        },
      ]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
