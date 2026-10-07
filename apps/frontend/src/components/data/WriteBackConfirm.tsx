import React from 'react';
import { cancelWriteBack, confirmWriteBack, useWriteBackRequest } from './writeBackRequest';
import './data.css';

/**
 * The question a value dragged on a linked chart has to answer before the
 * table is written: the exact cell and the change, as the Data panel words it.
 */
export const WriteBackConfirm: React.FC = () => {
  const request = useWriteBackRequest();
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (request) confirmRef.current?.focus();
  }, [request]);

  if (!request) return null;
  const { plan, tableName } = request;
  return (
    <div
      className="data-confirm data-confirm--float"
      role="alertdialog"
      aria-label="Write to the table"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancelWriteBack();
        }
      }}
    >
      <p>
        {'Write '}
        <strong>{plan.after}</strong>
        {` to ${tableName}!${plan.cell}`}
        {plan.before.trim() ? `, replacing ${plan.before.trim()}?` : '?'}
      </p>
      <div className="data-confirm__actions">
        <button type="button" className="data-textbtn" onClick={cancelWriteBack}>
          Cancel
        </button>
        <button ref={confirmRef} type="button" className="data-primary" onClick={confirmWriteBack}>
          Write to table
        </button>
      </div>
    </div>
  );
};
