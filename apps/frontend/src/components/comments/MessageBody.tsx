import React, { useMemo } from 'react';
import { parseMessage } from '../../engine/comments/threads';

/**
 * A message body with its mentions rendered as chips.
 *
 * A mention of **you** is tinted differently from a mention of somebody else,
 * because "Dana is asking Mike" and "Dana is asking me" are the two facts you
 * are scanning a thread for, and they should not look identical.
 */
export const MessageBody: React.FC<{ body: string; myAuthorId: string }> = ({
  body,
  myAuthorId,
}) => {
  const segments = useMemo(() => parseMessage(body), [body]);

  return (
    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {segments.map((segment, i) =>
        segment.kind === 'text' ? (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        ) : (
          <span
            key={i}
            className="mention-chip"
            data-me={segment.authorId === myAuthorId ? 'true' : undefined}
          >
            @{segment.text}
          </span>
        )
      )}
    </span>
  );
};
