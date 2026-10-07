import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Check, Pencil, Trash2, X } from 'lucide-react';
import type { VersionMeta } from '../../engine/history/historyApi';
import {
  clockLabel,
  clockRange,
  dayLabel,
  namesLabel,
  type ReplaySession,
} from '../../engine/history/sessions';
import { AvatarStack } from '../ui/Avatar';
import { Button } from '../ui/Button';
import type { Versions } from './useVersions';

type Entry =
  | { kind: 'session'; key: string; at: number; index: number; session: ReplaySession }
  | { kind: 'version'; key: string; at: number; version: VersionMeta };

interface Props {
  sessions: readonly ReplaySession[];
  versions: Versions;
  /** The session under the playhead, or -1. */
  currentSession: number;
  /** The saved version on screen, or null. */
  currentVersion: number | null;
  atLatest: boolean;
  canEdit: boolean;
  /** What "Save version" would keep, in words. */
  saveTarget: string;
  onSave: (name: string, description: string) => Promise<void>;
  onSelectLatest: () => void;
  onSelectSession: (index: number) => void;
  onSelectVersion: (version: VersionMeta) => void;
  onClose: () => void;
}

const changesLabel = (n: number) => `${n.toLocaleString()} change${n === 1 ? '' : 's'}`;

/**
 * The version list: the board now, then every session in the log, every
 * autosave and every named version, newest first and grouped by day.
 */
export const VersionsPanel: React.FC<Props> = ({
  sessions,
  versions,
  currentSession,
  currentVersion,
  atLatest,
  canEdit,
  saveTarget,
  onSave,
  onSelectLatest,
  onSelectSession,
  onSelectVersion,
  onClose,
}) => {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const entries = useMemo(() => {
    const list: Entry[] = [];
    sessions.forEach((session, index) =>
      list.push({ kind: 'session', key: `s${session.first}`, at: session.endAt, index, session })
    );
    versions.versions.forEach((version) =>
      list.push({ kind: 'version', key: `v${version.id}`, at: Date.parse(version.endedAt), version })
    );
    list.sort((a, b) => b.at - a.at);
    const groups: { day: string; entries: Entry[] }[] = [];
    for (const entry of list) {
      const day = dayLabel(entry.at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.entries.push(entry);
      else groups.push({ day, entries: [entry] });
    }
    return groups;
  }, [sessions, versions.versions]);

  const run = async (work: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await work();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That did not work. Try again.');
      return false;
    }
  };

  return (
    <aside className="replay-versions panel-surface" aria-label="Version history">
      <header className="replay-versions__head">
        <h2 className="replay-versions__title">Version history</h2>
        <button type="button" className="btn-icon btn-icon--sm" onClick={onClose} aria-label="Hide version history" data-tooltip="Hide version history">
          <X size={16} />
        </button>
      </header>

      {canEdit && !composing && (
        <div className="replay-versions__save">
          <Button variant="secondary" size="sm" block icon={<BookmarkPlus size={14} />} onClick={() => setComposing(true)}>
            Save version…
          </Button>
        </div>
      )}
      {composing && (
        <VersionForm
          submitLabel="Save version"
          hint={`Keeps ${saveTarget}, even after older changes are trimmed.`}
          onCancel={() => setComposing(false)}
          onSubmit={async (name, description) => {
            if (await run(() => onSave(name, description))) setComposing(false);
          }}
        />
      )}
      {actionError && <p className="replay-versions__error" role="alert">{actionError}</p>}

      <div className="replay-versions__list" role="list">
        <button
          type="button"
          role="listitem"
          className="replay-entry"
          aria-current={atLatest && currentVersion === null ? 'true' : undefined}
          onClick={onSelectLatest}
        >
          <span className="replay-entry__title">Current version</span>
          <span className="replay-entry__meta">The board as it is now</span>
        </button>

        {entries.map((group) => (
          <section key={group.day} className="replay-versions__group" aria-label={group.day}>
            <h3 className="replay-versions__day">{group.day}</h3>
            {group.entries.map((entry) => {
              if (entry.kind === 'session') {
                const s = entry.session;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="listitem"
                    className="replay-entry"
                    aria-current={currentVersion === null && currentSession === entry.index ? 'true' : undefined}
                    onClick={() => onSelectSession(entry.index)}
                  >
                    <span className="replay-entry__title">{clockRange(s.startAt, s.endAt)}</span>
                    <span className="replay-entry__meta">
                      <AvatarStack size={16} max={3} people={s.authors.map((a) => ({ key: a.id, name: a.name, color: a.color }))} />
                      <span className="replay-entry__meta-text">
                        {namesLabel(s.authors)} · {changesLabel(s.updateCount)}
                      </span>
                    </span>
                  </button>
                );
              }

              const v = entry.version;
              const named = v.kind === 'named';
              const when = clockLabel(Date.parse(v.endedAt));
              if (editing === v.id) {
                return (
                  <VersionForm
                    key={entry.key}
                    initialName={v.name ?? ''}
                    initialDescription={v.description ?? ''}
                    submitLabel={named ? 'Rename' : 'Name version'}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (name, description) => {
                      if (await run(() => versions.rename(v.id, { name, description }))) setEditing(null);
                    }}
                  />
                );
              }
              return (
                <div key={entry.key} className="replay-entry-row" role="listitem">
                  <button
                    type="button"
                    className="replay-entry"
                    data-named={named ? '' : undefined}
                    aria-current={currentVersion === v.id ? 'true' : undefined}
                    onClick={() => onSelectVersion(v)}
                  >
                    <span className="replay-entry__title">
                      {named ? v.name : `Autosave · ${clockRange(Date.parse(v.startedAt), Date.parse(v.endedAt))}`}
                    </span>
                    {named && v.description && <span className="replay-entry__desc">{v.description}</span>}
                    <span className="replay-entry__meta">
                      {v.authors.length > 0 && (
                        <AvatarStack size={16} max={3} people={v.authors.map((a) => ({ key: a.id, name: a.name, color: a.color }))} />
                      )}
                      <span className="replay-entry__meta-text">
                        {named
                          ? [when, v.createdByName].filter(Boolean).join(' · ')
                          : [v.authors.length > 0 ? namesLabel(v.authors) : null, changesLabel(v.updateCount)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                  {canEdit && (
                    <span className="replay-entry__tools">
                      {confirming === v.id ? (
                        <>
                          <button
                            type="button"
                            className="btn-icon btn-icon--sm replay-entry__danger"
                            aria-label={`Delete ${v.name}`}
                            data-tooltip="Delete for everyone"
                            onClick={() => run(() => versions.remove(v.id)).then(() => setConfirming(null))}
                          >
                            <Check size={14} />
                          </button>
                          <button type="button" className="btn-icon btn-icon--sm" aria-label="Keep it" data-tooltip="Keep it" onClick={() => setConfirming(null)}>
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-icon btn-icon--sm"
                            aria-label={named ? `Rename ${v.name}` : 'Name this autosave'}
                            data-tooltip={named ? 'Rename' : 'Name this version to keep it'}
                            onClick={() => setEditing(v.id)}
                          >
                            <Pencil size={14} />
                          </button>
                          {named && (
                            <button
                              type="button"
                              className="btn-icon btn-icon--sm"
                              aria-label={`Delete ${v.name}`}
                              data-tooltip="Delete"
                              onClick={() => setConfirming(v.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        ))}

        {versions.status === 'loading' && (
          <p className="replay-versions__note">Loading saved versions…</p>
        )}
        {versions.status === 'error' && (
          <p className="replay-versions__note">
            {versions.error}{' '}
            <button type="button" className="replay-versions__link" onClick={versions.reload}>
              Try again
            </button>
          </p>
        )}
        {versions.status === 'ready' && versions.versions.length === 0 && (
          <p className="replay-versions__note">
            Older sessions are kept here as autosaves once they leave the change log. Save a version to keep a moment for good.
          </p>
        )}
      </div>
    </aside>
  );
};

interface FormProps {
  initialName?: string;
  initialDescription?: string;
  submitLabel: string;
  hint?: string;
  onSubmit: (name: string, description: string) => Promise<void>;
  onCancel: () => void;
}

const VersionForm: React.FC<FormProps> = ({ initialName = '', initialDescription = '', submitLabel, hint, onSubmit, onCancel }) => {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    await onSubmit(name.trim(), description.trim());
    setSaving(false);
  };

  return (
    <form
      className="replay-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <label className="replay-form__field">
        <span className="replay-form__label">Name</span>
        <input
          ref={input}
          className="replay-form__input"
          value={name}
          maxLength={80}
          placeholder="Before the review"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="replay-form__field">
        <span className="replay-form__label">Description</span>
        <textarea
          className="replay-form__input replay-form__textarea"
          value={description}
          maxLength={500}
          rows={2}
          placeholder="What changed, and why it is worth keeping"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {hint && <p className="replay-form__hint">{hint}</p>}
      <div className="replay-form__actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" type="submit" disabled={!name.trim() || saving}>
          {saving ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
};
