import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Square } from 'lucide-react';
import { editor } from '../../../engine/api/EditorAPI';
import { flattenToPath } from '../../../engine/document/vectorOps';
import { swapShapeKind } from '../../../engine/model/shapeSwap';
import { hasBend, isMultiPoint } from '../../../engine/model/polyline';
import { LINE_PROFILES, LINE_PROFILE_LABELS, type LineProfile } from '../../../engine/model/linePath';
import {
  MAX_POLYGON_SIDES,
  MIN_POLYGON_SIDES,
  isOpenShape,
  type ShapeNode,
} from '../../../engine/model/schema';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { LineSpecimen } from '../../panel/lineSpecimen';
import { LineProfileIcon } from '../../panel/lineProfileIcons';
import { KindPicker } from '../../workspace/KindPicker';
import { SHAPE_BY_PRESET } from '../../workspace/shapeCatalog';
import { SHAPE_FACETS, SHAPE_GLYPH, SHAPE_TILE, presetForGeometry, shapeGroups } from '../../workspace/shapePicker';
import { PopoverSlider, VectorEditIcon } from '../RailBase';
import { RailPopover } from '../RailPopover';
import { SHAPE_CHOICES } from '../railConstants';
import { kindOf } from './kindOf';


/**
 * What the selection is, as a label.
 *
 * Tertiary ink: it says what you have, and everything to its right acts on it.
 */
export const KindLabel: React.FC<{ icon: React.ReactNode; name: string; hint?: string }> = ({ icon, name, hint }) => (
  <span className="ctx-kind" data-tooltip={hint}>
    {icon}
    {name}
  </span>
);

/**
 * A shape's kind chip, which is also its swapper.
 *
 * The chip wears the shape it is, by name, and opens the same picker the dock
 * uses. A line swaps within lines first; crossing families throws work away,
 * so the other family sits behind a disclosure that names the direction.
 */
export const ShapeKindChip: React.FC<{ node: ShapeNode }> = ({ node }) => {
  const [otherOpen, setOtherOpen] = useState(false);
  const [category, setCategory] = useState('basic');
  const open = isOpenShape(node.geometry.kind);
  const name = kindOf(node, open ? 'line' : 'shape').name;
  const update = (updates: Record<string, unknown>) => editor.updateNode(node.id, updates);
  const multiPoint =
    isMultiPoint(node.geometry.vertices) || hasBend(node.geometry.bends) || node.geometry.smooth === true;

  const glyph = open ? (
    <LineSpecimen profile={node.geometry.lineProfile} endStart={node.geometry.endStart} endEnd={node.geometry.endEnd} />
  ) : (
    SHAPE_CHOICES.find(
      (c) => c.kind === node.geometry.kind && (c.points === undefined || node.geometry.points === c.points)
    )?.icon ?? <Square size={16} />
  );

  const closedTiles = (
    <KindPicker
      columns={5}
      tile={SHAPE_TILE - 8}
      search
      searchPlaceholder="Search shapes"
      groups={shapeGroups(category, SHAPE_GLYPH - 2)}
      facets={SHAPE_FACETS}
      activeFacet={category}
      onFacet={setCategory}
      value={presetForGeometry(node.geometry)}
      onPick={(preset) => {
        const recipe = SHAPE_BY_PRESET[preset].geometry;
        // Size, paint and position survive; `swapShapeKind` keeps only what the new kind can express.
        update({ geometry: swapShapeKind(node.geometry, recipe.kind, recipe.points) });
      }}
    />
  );

  const lineTiles = (
    <div className="ctx-shape-grid">
      {SHAPE_CHOICES.filter((c) => isOpenShape(c.kind)).map((choice) => (
        <button
          key={choice.kind}
          type="button"
          className="ctx-shape-btn"
          aria-pressed={node.geometry.kind === choice.kind}
          aria-label={choice.label}
          data-tooltip={choice.label}
          onClick={() => update({ geometry: swapShapeKind(node.geometry, choice.kind) })}
        >
          <LineSpecimen
            profile={node.geometry.lineProfile}
            endEnd={choice.kind === 'arrow' ? (node.geometry.endEnd ?? 'arrow') : 'none'}
            run={multiPoint ? (node.geometry.smooth ? 'rounded' : 'corners') : 'two-point'}
          />
        </button>
      ))}
    </div>
  );

  const counts = (
    <>
      {(node.geometry.kind === 'polygon' || node.geometry.kind === 'star') && (
        <PopoverSlider
          label={node.geometry.kind === 'star' ? 'Points' : 'Sides'}
          value={node.geometry.points ?? 3}
          min={MIN_POLYGON_SIDES}
          max={MAX_POLYGON_SIDES}
          onChange={(points) => update({ geometry: { ...node.geometry, points } })}
        />
      )}
      {node.geometry.kind === 'star' && (
        <PopoverSlider
          label="Depth"
          value={Math.round((node.geometry.innerRatio ?? 0.5) * 100)}
          min={10}
          max={90}
          suffix="%"
          onChange={(v) => update({ geometry: { ...node.geometry, innerRatio: v / 100 } })}
        />
      )}
    </>
  );

  // A profile runs along one segment, so a line with corners takes its shape from its points instead.
  const lineStyle = multiPoint ? (
    <p className="ctx-popover__note">
      This line takes its shape from its points. Round its corners from the rail, or edit the points to bend one
      segment.
    </p>
  ) : (
    <>
      <span className="ctx-popover__label">Style</span>
      <SegmentedControl
        ariaLabel="Line style"
        value={node.geometry.lineProfile ?? 'straight'}
        onChange={(v) =>
          update({
            geometry: { ...node.geometry, lineProfile: v === 'straight' ? undefined : (v as LineProfile) },
          })
        }
        segments={LINE_PROFILES.map((profile) => ({
          value: profile,
          label: LINE_PROFILE_LABELS[profile],
          hint: LINE_PROFILE_LABELS[profile],
          icon: <LineProfileIcon profile={profile} />,
        }))}
      />
    </>
  );

  return (
    <RailPopover
      label={open ? 'Change line' : 'Change shape'}
      float
      align="start"
      trigger={
        <span className="rail-kind">
          {glyph}
          <span className="rail-kind__name">{name}</span>
          <ChevronDown size={12} aria-hidden className="rail-kind__chevron" />
        </span>
      }
    >
      {open ? (
        <>
          <span className="ctx-popover__label">Line</span>
          {lineTiles}
          {lineStyle}
          <div className="ctx-popover__rule" role="presentation" />
          <button
            type="button"
            className="ctx-popover__disclosure"
            aria-expanded={otherOpen}
            onClick={() => setOtherOpen((v) => !v)}
          >
            <ChevronRight size={13} className={otherOpen ? 'is-open' : undefined} aria-hidden="true" />
            Convert to a shape
          </button>
          {otherOpen && closedTiles}
        </>
      ) : (
        <>
          <span className="ctx-popover__label">Shape</span>
          {closedTiles}
          {counts}
        </>
      )}
      <div className="ctx-popover__rule" role="presentation" />
      <button type="button" className="ctx-popover__action" onClick={() => flattenToPath(node.id)}>
        <VectorEditIcon size={14} />
        Convert to vector path
      </button>
    </RailPopover>
  );
};
