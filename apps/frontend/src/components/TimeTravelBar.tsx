import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronUp, History, Loader2, RotateCw, X } from 'lucide-react';
import { cameraSystem } from '../engine/CameraSystem';
import { fitPose, type FitBounds } from '../engine/cameraFit';
import { doc, groupsMap, localAuthor, normalizeNode, objectsMap, undoManager } from '../engine/document';
import { getRoomRole, subscribeRoomRole } from '../engine/model/permissions';
import { nodeLabel } from '../engine/model/nodeLabel';
import { writeClipboard } from '../engine/clipboard/clipboard';
import { notify, notifyUndoable } from '../engine/ui/notices';
import type { AnyNode } from '../engine/model/schema';
import { changedBetween, type Frame, type FrameState, type ObjectJson } from '../engine/history/frames';
import { diffFrames, type FrameDiff } from '../engine/history/diff';
import { restoreVersion } from '../engine/history/restore';
import { planSize } from '../engine/history/restorePlan';
import { watchLiveChanges } from '../engine/history/liveChanges';
import { OBJECT_HISTORY_EVENT, takeObjectHistoryRequest } from '../engine/history/objectHistory';
import type { Moment } from '../engine/history/sessionTimeline';
import type { VersionMeta } from '../engine/history/historyApi';
import {
  clockLabel,
  clockRange,
  dayLabel,
  groupSessions,
  momentsTouching,
  sessionOf,
  stepSession,
} from '../engine/history/sessions';
import { layoutTrack } from '../engine/history/trackLayout';
import { ChangesOverlay } from './replay/ChangesOverlay';
import { ReplayBanner } from './replay/ReplayBanner';
import { ReplayTimeline, type Speed } from './replay/ReplayTimeline';
import { VersionsPanel } from './replay/VersionsPanel';
import { useReplayHistory } from './replay/useReplayHistory';
import { useVersions } from './replay/useVersions';
import type { FilterOption } from './replay/ObjectFilter';
import type { TrackMarker } from './replay/ReplayTrack';
import './replay/replay.css';

interface TimeTravelBarProps {
  roomId: string;
  onClose: () => void;
  /**
   * Show a frame on the canvas, or `null` to hand it back to the live
   * document.
   * @param changedIds Ids that differ from the previous frame.
   */
  /**
   * The frame for the canvas, the ids that changed since the last one, and the
   * frame without the removed-object ghosts, for lists such as Layers that
   * should show only what existed at that moment.
   */
  onApplySnapshot: (
    objects: Record<string, any> | null,
    changedIds?: string[] | null,
    listed?: Record<string, any> | null
  ) => void;
}

type Cursor = { kind: 'moment'; index: number } | { kind: 'version'; id: number };

interface Shown {
  state: FrameState;
  base: FrameState | null;
}

const EMPTY_MOMENTS: Moment[] = [];

/** Space kept clear of the banner and the timeline when framing the session. */
const TOP_CLEARANCE = 72;
const BOTTOM_CLEARANCE = 210;
const PANEL_CLEARANCE = 332;

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function usePref(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => readPref(key, fallback));
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* a preference that cannot be stored is still applied for this visit */
      }
    },
    [key]
  );
  return [value, set];
}

function useRoomRole() {
  const [role, setRole] = useState(getRoomRole);
  useEffect(() => subscribeRoomRole(setRole), []);
  return role;
}

/** Frame the session once, in the space the replay chrome leaves clear. */
function frameSession(bounds: FitBounds | null, panelOpen: boolean) {
  if (!bounds) return;
  const width = cameraSystem.width - (panelOpen ? PANEL_CLEARANCE : 0);
  const height = Math.max(cameraSystem.height - TOP_CLEARANCE - BOTTOM_CLEARANCE, 200);
  const pose = fitPose(bounds, Math.max(width, 240), height, { ...cameraSystem.zoomLimits });
  if (pose) cameraSystem.setPose(pose.x, pose.y + TOP_CLEARANCE, pose.zoom);
}

/** Removed objects, drawn faded so the board shows what was taken away. */
const ghosts = new WeakMap<ObjectJson, ObjectJson>();
function ghostOf(json: ObjectJson): ObjectJson {
  let ghost = ghosts.get(json);
  if (!ghost) {
    const opacity = typeof json.opacity === 'number' ? json.opacity : 1;
    ghost = { ...json, opacity: opacity * 0.28, locked: true };
    ghosts.set(json, ghost);
  }
  return ghost;
}

/** Index of the moment closest in time to `at`. */
function momentNear(moments: readonly Moment[], at: number): number {
  let lo = 0;
  let hi = moments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (moments[mid].at < at) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(moments[lo - 1].at - at) <= Math.abs(moments[lo].at - at)) return lo - 1;
  return lo;
}

const timeWithSeconds = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const versionTitle = (v: VersionMeta) =>
  v.kind === 'named' && v.name
    ? v.name
    : `Autosave, ${dayLabel(Date.parse(v.endedAt))}, ${clockRange(Date.parse(v.startedAt), Date.parse(v.endedAt))}`;

/**
 * Version history: the board as it stood at any change in the log, at any
 * autosave, or at any named version, read-only, with what changed outlined.
 *
 * Owns the replay session from open to close. The canvas is driven through
 * `onApplySnapshot`, which sets the store's `isReplaying` so tools, derived
 * writers and live observers all stand down; leaving hands the canvas back to
 * the live document. Restore leaves first and then writes, so the restore is
 * an ordinary edit that everything downstream sees.
 */
export const TimeTravelBar: React.FC<TimeTravelBarProps> = ({ roomId, onClose, onApplySnapshot }) => {
  const history = useReplayHistory(roomId);
  const versions = useVersions(roomId);
  const role = useRoomRole();
  const canEdit = role === 'editor';

  const moments = history.timeline?.moments ?? EMPTY_MOMENTS;
  const sessions = useMemo(() => groupSessions(moments), [moments]);
  const layout = useMemo(() => layoutTrack(moments, sessions), [moments, sessions]);

  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [filterId, setFilterId] = useState<string | null>(() => takeObjectHistoryRequest());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [showChanges, setShowChanges] = usePref('vega_replay_changes', true);
  const [versionsOpen, setVersionsOpen] = usePref(
    'vega_replay_versions',
    typeof window !== 'undefined' && window.innerWidth >= 1100
  );
  const [collapsed, setCollapsed] = usePref('vega_timetravel_collapsed', false);
  const [liveChanges, setLiveChanges] = useState(0);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);

  const onApplyRef = useRef(onApplySnapshot);
  useEffect(() => {
    onApplyRef.current = onApplySnapshot;
  }, [onApplySnapshot]);
  const emitted = useRef<Frame>({});
  /** Set once the canvas has been handed back, so it is not handed back twice. */
  const released = useRef(false);

  // Hand the canvas back to the live document however this closes.
  useEffect(
    () => () => {
      if (!released.current) onApplyRef.current(null);
    },
    []
  );

  useEffect(() => watchLiveChanges(doc, [objectsMap, groupsMap], setLiveChanges), []);

  // Another "Show history" while open re-targets the filter.
  useEffect(() => {
    const onRequest = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      takeObjectHistoryRequest();
      if (typeof id === 'string') setFilterId(id);
    };
    window.addEventListener(OBJECT_HISTORY_EVENT, onRequest);
    return () => window.removeEventListener(OBJECT_HISTORY_EVENT, onRequest);
  }, []);

  const only = useMemo(() => (filterId ? momentsTouching(moments, filterId) : null), [filterId, moments]);
  const onlySet = useMemo(() => (filterId ? new Set([filterId]) : null), [filterId]);

  // Land on the latest change once the log is built, and frame the session.
  const landed = useRef(false);
  useEffect(() => {
    if (history.status !== 'ready' || landed.current) return;
    landed.current = true;
    frameSession(history.timeline?.bounds ?? null, versionsOpen);
    if (moments.length === 0) return;
    const target = only && only.length > 0 ? only[only.length - 1] : moments.length - 1;
    setCursor({ kind: 'moment', index: target });
  }, [history.status, history.timeline, moments, only, versionsOpen]);

  // A cached log opens first and newer rows fold in after: whoever is still
  // parked on the latest moment follows it to the new latest.
  const lastCount = useRef(0);
  useEffect(() => {
    const before = lastCount.current;
    lastCount.current = moments.length;
    if (before === 0 || moments.length <= before || playing) return;
    setCursor((c) => {
      if (c?.kind !== 'moment' || c.index !== before - 1) return c;
      if (only) return only.length > 0 ? { kind: 'moment', index: only[only.length - 1] } : c;
      return { kind: 'moment', index: moments.length - 1 };
    });
  }, [moments, only, playing]);

  // A new filter lands on that object's latest change.
  const lastFilter = useRef(filterId);
  useEffect(() => {
    if (lastFilter.current === filterId) return;
    lastFilter.current = filterId;
    if (only && only.length > 0) setCursor({ kind: 'moment', index: only[only.length - 1] });
  }, [filterId, only]);

  const sessionIndex = cursor?.kind === 'moment' ? sessionOf(sessions, cursor.index) : -1;

  // Materialise a moment from the log.
  useEffect(() => {
    const engine = history.engine;
    if (!engine || cursor?.kind !== 'moment') return;
    const moment = moments[cursor.index];
    if (!moment) return;
    const { state } = engine.seek(moment.index);
    let base: FrameState | null = null;
    if (showChanges && sessionIndex >= 0) {
      base = engine.peek(moments[sessions[sessionIndex].first].firstIndex - 1);
    }
    setShown({ state, base });
  }, [history.engine, cursor, moments, sessions, sessionIndex, showChanges]);

  // Load a saved version, and the one before it for the comparison.
  const versionList = versions.versions;
  const { stateOf } = versions;
  useEffect(() => {
    if (cursor?.kind !== 'version') return;
    let cancelled = false;
    const at = versionList.findIndex((v) => v.id === cursor.id);
    const older = at >= 0 ? versionList[at + 1] : undefined;
    (async () => {
      const state = await stateOf(cursor.id);
      const base = showChanges && older ? await stateOf(older.id) : null;
      if (!cancelled) setShown({ state, base });
    })().catch((err: unknown) => {
      if (cancelled) return;
      notify({ message: err instanceof Error ? err.message : 'That version could not be opened.', tone: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [cursor, versionList, stateOf, showChanges]);

  const diff: FrameDiff | null = useMemo(
    () => (shown && shown.base ? diffFrames(shown.base.objects, shown.state.objects, onlySet) : null),
    [shown, onlySet]
  );

  // Put the frame on the canvas, with removed objects ghosted.
  useEffect(() => {
    if (!shown) return;
    let out: Frame = shown.state.objects;
    if (showChanges && diff && shown.base && diff.removed.length > 0) {
      const withGhosts: Record<string, ObjectJson> = { ...out };
      for (const id of diff.removed.slice(0, 400)) withGhosts[id] = ghostOf(shown.base.objects[id]);
      out = withGhosts;
    }
    const changed = changedBetween(emitted.current, out);
    emitted.current = out;
    onApplyRef.current(out as Record<string, any>, changed, shown.state.objects as Record<string, any>);
  }, [shown, diff, showChanges]);

  // Playback, paced by the authoring itself: the pause between two changes,
  // capped so a coffee break does not stall it, divided by the speed.
  useEffect(() => {
    if (!playing || cursor?.kind !== 'moment') return;
    const seq = only;
    const next = seq ? seq[seq.indexOf(cursor.index) + 1] : cursor.index + 1;
    if (next === undefined || next >= moments.length) {
      setPlaying(false);
      return;
    }
    const gap = moments[next].at - moments[cursor.index].at;
    const timer = window.setTimeout(
      () => setCursor({ kind: 'moment', index: next }),
      Math.min(1200, Math.max(70, gap)) / speed
    );
    return () => window.clearTimeout(timer);
  }, [playing, cursor, only, moments, speed]);

  const seek = useCallback((index: number) => setCursor({ kind: 'moment', index }), []);

  const step = useCallback(
    (direction: -1 | 1, bySession = false) => {
      setPlaying(false);
      setCursor((c) => {
        if (moments.length === 0) return c;
        const from = c?.kind === 'moment' ? c.index : moments.length - 1;
        if (bySession && !only) return { kind: 'moment', index: stepSession(sessions, from, direction) };
        if (only) {
          if (only.length === 0) return c;
          const at = only.indexOf(from);
          const k = at === -1 ? (direction > 0 ? 0 : only.length - 1) : Math.min(only.length - 1, Math.max(0, at + direction));
          return { kind: 'moment', index: only[k] };
        }
        return { kind: 'moment', index: Math.min(moments.length - 1, Math.max(0, from + direction)) };
      });
    },
    [moments, sessions, only]
  );

  const edge = useCallback(
    (which: 'first' | 'last') => {
      setPlaying(false);
      const seq = only ?? null;
      if (seq && seq.length === 0) return;
      if (!seq && moments.length === 0) return;
      const index = which === 'first' ? (seq ? seq[0] : 0) : seq ? seq[seq.length - 1] : moments.length - 1;
      setCursor({ kind: 'moment', index });
    },
    [moments, only]
  );

  const togglePlay = useCallback(() => {
    if (moments.length === 0) return;
    if (!playing) {
      const seq = only ?? null;
      const last = seq ? seq[seq.length - 1] : moments.length - 1;
      if (cursor?.kind !== 'moment' || cursor.index === last) {
        setCursor({ kind: 'moment', index: seq ? seq[0] : 0 });
      }
    }
    setPlaying((p) => !p);
  }, [moments, playing, only, cursor]);

  const atLatest = cursor?.kind === 'moment' && cursor.index === moments.length - 1;
  const isCurrent = atLatest && liveChanges === 0;
  const viewedVersion = cursor?.kind === 'version' ? versionList.find((v) => v.id === cursor.id) ?? null : null;
  const moment = cursor?.kind === 'moment' ? moments[cursor.index] : undefined;
  const filterLabel = useMemo(() => {
    if (!filterId) return null;
    const json = shown?.state.objects[filterId] ?? shown?.base?.objects[filterId];
    const node = json ? normalizeNode(json as Record<string, unknown>, filterId) : null;
    return node ? nodeLabel(node) : 'a removed object';
  }, [filterId, shown]);

  const title = viewedVersion
    ? versionTitle(viewedVersion)
    : moment
      ? `${dayLabel(moment.at)}, ${timeWithSeconds(moment.at)}`
      : '';

  const restore = useCallback(() => {
    if (!shown || !canEdit || busy) return;
    setBusy(true);
    setPlaying(false);
    const target = shown.state;
    // Leave replay first: the restore is a live edit, and derived writers
    // stand down while `isReplaying` is set.
    onApplyRef.current(null);
    released.current = true;
    emitted.current = {};
    const plan = restoreVersion(target, onlySet);
    if (!plan) {
      notify({ message: 'Only editors can restore versions.', tone: 'error' });
    } else if (planSize(plan) === 0 && plan.groups.length === 0) {
      notify({ message: 'The board already matches this version.', tone: 'info' });
    } else {
      notifyUndoable(filterLabel ? `Restored ${filterLabel} from ${title}` : `Restored the board to ${title}`, () =>
        undoManager.undo()
      );
    }
    onClose();
  }, [shown, canEdit, busy, onlySet, filterLabel, title, onClose]);

  const copy = useCallback(async () => {
    if (!shown) return;
    const ids = filterId ? [filterId] : Object.keys(shown.state.objects);
    const nodes: AnyNode[] = [];
    for (const id of ids) {
      const json = shown.state.objects[id];
      const node = json ? normalizeNode(json as Record<string, unknown>, id) : null;
      if (node) nodes.push(node);
    }
    const payload = writeClipboard(nodes);
    if (!payload) {
      notify({ message: 'There is nothing to copy in this version.', tone: 'info' });
      return;
    }
    const n = payload.nodes.length;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      notify({
        message: `Copied ${n.toLocaleString()} object${n === 1 ? '' : 's'} from this version. Exit and paste to bring ${n === 1 ? 'it' : 'them'} back.`,
        tone: 'success',
      });
    } catch {
      notify({ message: 'The clipboard refused the copy. Allow clipboard access for this site and try again.', tone: 'warning' });
    }
  }, [shown, filterId]);

  const saveTarget = viewedVersion
    ? 'this version'
    : atLatest || !moment
      ? 'the board as it is now'
      : `the board as it was at ${timeWithSeconds(moment.at)}`;

  const saveVersion = useCallback(
    async (name: string, description: string) => {
      if (viewedVersion) {
        await versions.rename(viewedVersion.id, { name, description });
        return;
      }
      const created = await versions.save({
        name,
        description,
        atUpdateId: !atLatest && moment?.rowId ? moment.rowId : null,
        createdByName: localAuthor().name,
      });
      notify({ message: `Saved “${created.name}” to version history.`, tone: 'success' });
    },
    [viewedVersion, versions, atLatest, moment]
  );

  const filterOptions = useCallback((): FilterOption[] => {
    const counts = new Map<string, number>();
    for (const m of moments) for (const id of m.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const latest = history.engine?.peek(moments.length > 0 ? moments[moments.length - 1].index : -1).objects ?? {};
    const out: FilterOption[] = [];
    counts.forEach((changes, id) => {
      const json = latest[id] ?? shown?.state.objects[id];
      const node = json ? normalizeNode(json as Record<string, unknown>, id) : null;
      if (node?.type === 'comment') return;
      out.push({ id, label: node ? nodeLabel(node) : 'Removed object', changes });
    });
    return out.sort((a, b) => b.changes - a.changes);
  }, [moments, history.engine, shown]);

  const markers: TrackMarker[] = useMemo(() => {
    if (moments.length === 0) return [];
    const first = moments[0].firstAt;
    const last = moments[moments.length - 1].at;
    return versionList
      .filter((v) => v.kind === 'named')
      .map((v) => ({ v, at: Date.parse(v.endedAt) }))
      .filter(({ at }) => at >= first && at <= last + 1000)
      .map(({ v, at }) => ({ key: String(v.id), x: layout.xs[momentNear(moments, at)], label: v.name ?? 'Named version' }));
  }, [versionList, moments, layout]);

  // Keyboard: arrows step a change, Shift+arrows a session, Home/End jump,
  // K plays, Escape leaves. Space is left to the canvas, where it pans.
  //
  // Taken in the capture phase and stopped there: the room's own shortcuts
  // are not replay-aware, and K is also the chart tool, so letting the key
  // through would arm a tool behind the replay that is still armed on exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.(
          'input, textarea, select, [contenteditable="true"], .popover, [role="radiogroup"], [role="listbox"], [role="menu"]'
        )
      ) {
        return;
      }
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
          step(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey);
          break;
        case 'Home':
        case 'End':
          edge(e.key === 'Home' ? 'first' : 'last');
          break;
        case 'k':
        case 'K':
          if (!e.repeat) togglePlay();
          break;
        case 'Escape':
          // An open popover closes first; the next Escape leaves.
          if (document.querySelector('.popover.is-open')) handled = false;
          else onClose();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, edge, togglePlay, onClose]);

  const position = (() => {
    if (viewedVersion) return viewedVersion.kind === 'named' ? 'Named version' : 'Autosave';
    if (!moment || cursor?.kind !== 'moment') return '';
    if (only && only.length === 0) return 'No changes to this object in the log';
    if (only) return `Change ${(only.indexOf(cursor.index) + 1).toLocaleString()} of ${only.length.toLocaleString()}`;
    return `Change ${(cursor.index + 1).toLocaleString()} of ${moments.length.toLocaleString()} · Session ${sessionIndex + 1} of ${sessions.length}`;
  })();

  const heading = viewedVersion
    ? {
        label: versionTitle(viewedVersion),
        time: viewedVersion.kind === 'named' ? `${dayLabel(Date.parse(viewedVersion.endedAt))}, ${clockLabel(Date.parse(viewedVersion.endedAt))}` : '',
        author: null,
      }
    : moment
      ? { label: moment.label, time: timeWithSeconds(moment.at), author: { name: moment.authorName, color: moment.authorColor } }
      : { label: 'No changes yet', time: '', author: null };

  const panel = versionsOpen && (
    <VersionsPanel
      sessions={sessions}
      versions={versions}
      currentSession={sessionIndex}
      currentVersion={viewedVersion?.id ?? null}
      atLatest={atLatest}
      canEdit={canEdit}
      saveTarget={saveTarget}
      onSave={saveVersion}
      onSelectLatest={() => edge('last')}
      onSelectSession={(i) => {
        setPlaying(false);
        setCursor({ kind: 'moment', index: sessions[i].last });
      }}
      onSelectVersion={(v) => {
        setPlaying(false);
        setCursor({ kind: 'version', id: v.id });
      }}
      onClose={() => setVersionsOpen(false)}
    />
  );

  let dock: React.ReactNode;
  if (history.status === 'loading') {
    const { processed, total } = history.progress;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    dock = (
      <div className="replay-dock replay-dock--message panel-surface" role="status">
        <Loader2 size={16} className="replay-spin" aria-hidden="true" />
        <span className="replay-dock__message">
          Reading history{total > 0 ? ` · ${processed.toLocaleString()} of ${total.toLocaleString()} changes` : '…'}
        </span>
        <span className="replay-progress" aria-hidden="true">
          <span className="replay-progress__bar" style={{ transform: `scaleX(${pct / 100})` }} />
        </span>
        <button type="button" className="btn-icon btn-icon--sm" onClick={onClose} aria-label="Exit version history">
          <X size={16} />
        </button>
      </div>
    );
  } else if (history.status === 'error') {
    dock = (
      <div className="replay-dock replay-dock--message panel-surface" role="alert">
        <AlertTriangle size={16} className="replay-dock__warn" aria-hidden="true" />
        <span className="replay-dock__message">{history.error}</span>
        <button type="button" className="btn-icon btn-icon--sm" onClick={history.retry} aria-label="Try again" data-tooltip="Try again">
          <RotateCw size={15} />
        </button>
        <button type="button" className="btn-icon btn-icon--sm" onClick={onClose} aria-label="Exit version history">
          <X size={16} />
        </button>
      </div>
    );
  } else if (moments.length === 0) {
    dock = (
      <div className="replay-dock replay-dock--message panel-surface" role="status">
        <History size={16} aria-hidden="true" className="replay-dock__muted" />
        <span className="replay-dock__message">
          No changes in the log yet. Edits appear on this timeline as people work, and saved versions are listed in version history.
        </span>
        <button type="button" className="btn-icon btn-icon--sm" onClick={onClose} aria-label="Exit version history">
          <X size={16} />
        </button>
      </div>
    );
  } else if (collapsed) {
    dock = (
      <button
        type="button"
        className="replay-handle panel-surface"
        onClick={() => setCollapsed(false)}
        aria-label={`Viewing ${title}. Show the timeline`}
        data-tooltip="Show the timeline"
      >
        <History size={14} aria-hidden="true" />
        <span className="replay-handle__text">{title}</span>
        {playing && <span className="replay-handle__live" aria-hidden="true" />}
        <ChevronUp size={14} aria-hidden="true" />
      </button>
    );
  } else {
    dock = (
      <ReplayTimeline
        moments={moments}
        sessions={sessions}
        layout={layout}
        current={cursor?.kind === 'moment' ? cursor.index : -1}
        only={only}
        markers={markers}
        heading={heading}
        position={position}
        playing={playing}
        speed={speed}
        filter={filterLabel ? { label: filterLabel } : null}
        filterOptions={filterOptions}
        legend={showChanges && diff ? diff : null}
        trimmedCount={history.trimmedCount}
        versionsOpen={versionsOpen}
        onSeek={(i) => {
          setPlaying(false);
          seek(i);
        }}
        onScrub={(active) => active && setPlaying(false)}
        onStep={(d) => step(d)}
        onEdge={edge}
        onTogglePlay={togglePlay}
        onSpeed={setSpeed}
        onPickFilter={setFilterId}
        onClearFilter={() => setFilterId(null)}
        onToggleVersions={() => setVersionsOpen(!versionsOpen)}
        onCollapse={() => setCollapsed(true)}
      />
    );
  }

  return (
    <div className="replay-root" data-versions={versionsOpen ? 'open' : undefined}>
      {shown && showChanges && diff && <ChangesOverlay diff={diff} frame={shown.state.objects} base={shown.base!.objects} />}
      {shown && (
        <ReplayBanner
          title={title}
          isCurrent={isCurrent && !viewedVersion}
          liveChanges={liveChanges}
          showChanges={showChanges}
          onShowChanges={setShowChanges}
          canRestore={canEdit}
          restoreLabel={filterId ? 'Restore this object' : 'Restore this version'}
          copyLabel={filterId ? 'Copy object' : 'Copy objects'}
          busy={busy}
          onRestore={restore}
          onCopy={copy}
          onExit={onClose}
        />
      )}
      {dock}
      {panel}
    </div>
  );
};
