import React, { useState, useSyncExternalStore } from 'react';
import {
  ChartGlyph, CodeGlyph, CommentGlyph, ConnectorGlyph, DirectSelectGlyph, EraserGlyph, FrameGlyph, GridGlyph,
  HandGlyph, HighlighterGlyph, ImageGlyph, LineGlyph, LinkGlyph, MarkerGlyph, MicGlyph, MoreGlyph, PencilGlyph,
  SelectGlyph, ShapeGlyph, StickyGlyph, TableGlyph, TypeGlyph, VectorPenGlyph,
} from '../dock/glyphs';
import { BottomSheet } from '../ui/BottomSheet';
import { drawSettings } from '../../engine/tools/drawSettings';
import { textEditing } from '../../engine/interaction/textEditing';
import { canUseTool, subscribeRoomRole } from '../../engine/model/permissions';
import {
  armedOnBar,
  isPhoneToolActive,
  phonePrimary,
  PHONE_TOOL_GROUPS,
  type PhoneGlyph,
  type PhoneTool,
} from './phoneToolModel';
import './phone.css';

const GLYPH: Record<PhoneGlyph, React.FC<{ size?: number }>> = {
  select: SelectGlyph, 'direct-select': DirectSelectGlyph, hand: HandGlyph,
  pen: PencilGlyph, marker: MarkerGlyph, highlighter: HighlighterGlyph, eraser: EraserGlyph, 'bezier-pen': VectorPenGlyph,
  sticky: StickyGlyph, shape: ShapeGlyph, line: LineGlyph, text: TypeGlyph, connector: ConnectorGlyph, frame: FrameGlyph,
  table: TableGlyph, chart: ChartGlyph, grid: GridGlyph, image: ImageGlyph, audio: MicGlyph, link: LinkGlyph,
  code: CodeGlyph, comment: CommentGlyph,
};

const Glyph: React.FC<{ glyph: PhoneGlyph; size?: number }> = ({ glyph, size = 22 }) => {
  const G = GLYPH[glyph];
  return <G size={size} />;
};

function arm(tool: PhoneTool) {
  if (tool.brush) drawSettings.set({ brush: tool.brush });
  window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: tool.tool }));
}

const roleSnapshot = () => canUseTool('shape-rect');
const subscribeRole = (fn: () => void) => subscribeRoomRole(() => fn());

/**
 * The phone's tool bar: six seats and More, along the bottom edge above the
 * home indicator. A tap arms a seat; More opens every tool as a sheet. The
 * armed seat is filled in ink, the same marker the desktop dock hands from
 * seat to seat, without the travel.
 *
 * It carries the `tool-dock` class so everything that keeps clear of the dock
 * (the selection bar, notices) measures it the same way.
 */
export const PhoneToolbar: React.FC<{ activeToolId: string }> = ({ activeToolId }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  // Re-render when the room role arrives, so a viewer's seats say they are unavailable.
  useSyncExternalStore(subscribeRole, roleSnapshot, roleSnapshot);
  const brush = useSyncExternalStore(drawSettings.subscribe, () => drawSettings.get().brush, () => 'pen');
  // While typing, the keyboard and its Style/Done bar take the bottom edge.
  const typing = useSyncExternalStore(textEditing.subscribe, textEditing.getSnapshot, textEditing.getSnapshot);
  const seats = phonePrimary(activeToolId);
  const moreArmed = !armedOnBar(activeToolId);

  return (
    <>
      <nav className="tool-dock phone-bar" aria-label="Tools" hidden={Boolean(typing)}>
        <div className="phone-bar__row" role="toolbar" aria-label="Tools" aria-orientation="horizontal">
          {seats.map((tool) => {
            const active = isPhoneToolActive(tool, activeToolId, { seat: true });
            const allowed = canUseTool(tool.tool);
            return (
              <button
                key={tool.id}
                type="button"
                className="phone-bar__seat"
                aria-label={tool.label}
                aria-pressed={active}
                disabled={!allowed}
                data-active={active || undefined}
                onClick={() => arm(tool)}
              >
                <Glyph glyph={tool.glyph} />
              </button>
            );
          })}
          <span className="phone-bar__rule" aria-hidden="true" />
          <button
            type="button"
            className="phone-bar__seat"
            aria-label="All tools"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            data-active={moreArmed || undefined}
            onClick={() => setMoreOpen(true)}
          >
            <MoreGlyph size={22} />
          </button>
        </div>
      </nav>
      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        label="All tools"
        snaps={['half', 'full']}
        initialSnap="half"
        className="phone-tools-sheet"
      >
        <div className="phone-tools">
          {PHONE_TOOL_GROUPS.map((group) => (
            <section key={group.label} className="phone-tools__group" aria-label={group.label}>
              <h3 className="phone-tools__heading">{group.label}</h3>
              <div className="phone-tools__grid">
                {group.tools.map((tool) => {
                  const active = isPhoneToolActive(tool, activeToolId, { brush });
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className="phone-tools__tile"
                      aria-pressed={active}
                      data-active={active || undefined}
                      disabled={!canUseTool(tool.tool)}
                      onClick={() => {
                        arm(tool);
                        setMoreOpen(false);
                      }}
                    >
                      <Glyph glyph={tool.glyph} size={24} />
                      <span className="phone-tools__label">{tool.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </BottomSheet>
    </>
  );
};
