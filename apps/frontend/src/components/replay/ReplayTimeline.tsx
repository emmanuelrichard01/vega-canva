import React from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PanelRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import type { Moment } from '../../engine/history/sessionTimeline';
import type { ReplaySession } from '../../engine/history/sessions';
import type { TrackLayout } from '../../engine/history/trackLayout';
import type { FrameDiff } from '../../engine/history/diff';
import { Avatar } from '../ui/Avatar';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ObjectFilter, type FilterOption } from './ObjectFilter';
import { ReplayTrack, type TrackMarker } from './ReplayTrack';

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

interface Props {
  moments: readonly Moment[];
  sessions: readonly ReplaySession[];
  layout: TrackLayout;
  current: number;
  only: readonly number[] | null;
  markers: readonly TrackMarker[];
  /** What the head describes: a moment, or a saved version. */
  heading: { label: string; time: string; author: { name: string; color: string } | null };
  position: string;
  playing: boolean;
  speed: Speed;
  filter: { label: string } | null;
  filterOptions: () => FilterOption[];
  legend: FrameDiff | null;
  trimmedCount: number;
  versionsOpen: boolean;
  onSeek: (index: number) => void;
  onScrub: (active: boolean) => void;
  onStep: (direction: -1 | 1) => void;
  onEdge: (edge: 'first' | 'last') => void;
  onTogglePlay: () => void;
  onSpeed: (speed: Speed) => void;
  onPickFilter: (id: string) => void;
  onClearFilter: () => void;
  onToggleVersions: () => void;
  onCollapse: () => void;
}

/**
 * The instrument along the bottom: what the playhead is on, the timeline, and
 * the transport.
 */
export const ReplayTimeline: React.FC<Props> = (p) => {
  const atStart = p.current >= 0 && (p.only ? p.only[0] === p.current : p.current === 0);
  const atEnd =
    p.current >= 0 && (p.only ? p.only[p.only.length - 1] === p.current : p.current === p.moments.length - 1);

  return (
    <div className="replay-dock panel-surface" role="group" aria-label="Timeline">
      <div className="replay-dock__head">
        {p.heading.author && <Avatar name={p.heading.author.name} color={p.heading.author.color} size={20} />}
        <span className="replay-dock__label">{p.heading.label}</span>
        <span className="replay-dock__time">{p.heading.time}</span>
        {p.filter && (
          <span className="replay-chip">
            History of {p.filter.label}
            <button type="button" className="replay-chip__clear" onClick={p.onClearFilter} aria-label="Show every object's history">
              <X size={12} />
            </button>
          </span>
        )}
        <span className="replay-dock__spacer" />
        <ObjectFilter options={p.filterOptions} onPick={p.onPickFilter} />
        <button
          type="button"
          className="btn-icon btn-icon--sm"
          aria-pressed={p.versionsOpen}
          aria-label="Version history"
          data-tooltip={p.versionsOpen ? 'Hide version history' : 'Show version history'}
          onClick={p.onToggleVersions}
        >
          <PanelRight size={16} />
        </button>
        <button
          type="button"
          className="btn-icon btn-icon--sm"
          aria-label="Minimise the timeline"
          data-tooltip="Minimise the timeline"
          onClick={p.onCollapse}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <ReplayTrack
        moments={p.moments}
        sessions={p.sessions}
        layout={p.layout}
        current={p.current}
        only={p.only}
        markers={p.markers}
        onSeek={p.onSeek}
        onScrub={p.onScrub}
      />

      <div className="replay-dock__foot">
        <div className="replay-transport">
          <button type="button" className="btn-icon btn-icon--sm" onClick={() => p.onEdge('first')} disabled={atStart} aria-label="First change" data-tooltip="First change (Home)">
            <SkipBack size={15} />
          </button>
          <button type="button" className="btn-icon btn-icon--sm" onClick={() => p.onStep(-1)} disabled={atStart} aria-label="Previous change" data-tooltip="Previous change (←) · Shift for the previous session">
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            className="replay-transport__play"
            onClick={p.onTogglePlay}
            aria-label={p.playing ? 'Pause' : 'Play the authoring back'}
            data-tooltip={p.playing ? 'Pause (K)' : 'Play (K)'}
          >
            {p.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="replay-transport__glyph" />}
          </button>
          <button type="button" className="btn-icon btn-icon--sm" onClick={() => p.onStep(1)} disabled={atEnd} aria-label="Next change" data-tooltip="Next change (→) · Shift for the next session">
            <ChevronRight size={17} />
          </button>
          <button type="button" className="btn-icon btn-icon--sm" onClick={() => p.onEdge('last')} disabled={atEnd} aria-label="Latest change" data-tooltip="Latest change (End)">
            <SkipForward size={15} />
          </button>
        </div>

        <SegmentedControl
          ariaLabel="Playback speed"
          value={String(p.speed)}
          onChange={(v) => p.onSpeed(Number(v) as Speed)}
          segments={SPEEDS.map((s) => ({ value: String(s), label: `${s}×`, hint: `Play at ${s}×` }))}
        />

        <span className="replay-dock__position">{p.position}</span>

        <span className="replay-dock__spacer" />

        {p.legend && (
          <span className="replay-legend" aria-label="Changes shown on the board">
            {p.legend.added.length > 0 && (
              <span className="replay-legend__item replay-legend__item--added">{p.legend.added.length.toLocaleString()} added</span>
            )}
            {p.legend.removed.length > 0 && (
              <span className="replay-legend__item replay-legend__item--removed">{p.legend.removed.length.toLocaleString()} removed</span>
            )}
            {p.legend.modified.length > 0 && (
              <span className="replay-legend__item replay-legend__item--modified">{p.legend.modified.length.toLocaleString()} changed</span>
            )}
            {p.legend.added.length + p.legend.removed.length + p.legend.modified.length === 0 && (
              <span className="replay-legend__none">No changes yet in this session</span>
            )}
          </span>
        )}
        {p.trimmedCount > 0 && !p.legend && (
          <span
            className="replay-dock__note"
            data-tooltip={`${p.trimmedCount.toLocaleString()} older changes have been folded into autosaves. Open them from version history.`}
          >
            Older sessions are in version history
          </span>
        )}
      </div>
    </div>
  );
};
