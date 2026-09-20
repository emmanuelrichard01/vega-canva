import React from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ClipboardPaste,
  Code2,
  Copy,
  CopyPlus,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FileDown,
  FileUp,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  Group,
  ImageDown,
  ImageOff,
  ImagePlus,
  Languages,
  Layers,
  Link2,
  ListOrdered,
  FoldVertical,
  UnfoldVertical,
  ExternalLink,
  Palette,
  PencilLine,
  Play,
  RotateCw,
  SquarePen,
  WrapText,
  Lock,
  Maximize,
  MessageSquarePlus,
  MousePointerSquareDashed,
  Paintbrush,
  PaintRoller,
  PenTool,
  Scissors,
  Shapes,
  Spline,
  StickyNote,
  Table2,
  TextCursorInput,
  Trash2,
  Type,
  UnfoldHorizontal,
  Ungroup,
  Unlock,
  Workflow,
  Scan,
} from 'lucide-react';
import type { AnyNode } from '../../engine/model/schema';
import { isOpenShape } from '../../engine/model/schema';
import { resolveAffordances } from '../../engine/selection/affordances';
import { canPasteStyle, type StyleSnapshot } from '../../engine/model/styleClipboard';
import { kindNoun } from '../../engine/model/selectMatching';
import type { RestackOp } from '../../engine/model/restack';
import type { AlignEdge, DistributeAxis } from '../../engine/model/align';
import type { ShapeKind } from '../../engine/model/schema';
import { canVectorize } from '../../engine/document/vectorOps';
import {
  copyTableCsv,
  exportTableCsv,
  fitTableColumns,
  importCsvIntoTable,
} from '../../engine/table/tableApply';
import { useStore } from '../../hooks/useStore';
import { presetForGeometry } from '../workspace/shapePicker';
import { StyleSwatch, ShapeSwapPanel, AddShapePanel } from './CanvasMenuPanels';
import { SHAPE_BY_PRESET, type ShapePreset } from '../workspace/shapeCatalog';
import { SHAPE_CHOICES } from '../toolbar/railConstants';
import { tidy, type MenuEntry } from './menuModel';
import type { CodeNode, LinkNode } from '../../engine/model/schema';
import { CODE_THEMES } from '../../engine/code/codeThemes';
import { CODE_THEME_IDS } from '../../engine/code/codeTypes';
import { languageById } from '../../engine/code/codeLanguages';
import { codeAsFence, codeFilename, downloadCode, updateCode } from '../../engine/code/codeApply';
import { languageMenuEntries, pickCodeLanguage } from '../code/codeMenus';
import { FOLD_AT } from '../toolbar/CodeRailSection';
import { providerFor, siteDomain } from '../../engine/link/linkProviders';
import { resolveDisplay } from '../../engine/link/linkLayout';
import { openLink, refreshPreview, setLinkDisplay } from '../../engine/link/linkApply';
import { LINK_DISPLAY_LABELS, type LinkDisplay } from '../../engine/link/linkTypes';
import { LinkDisplayIcon } from '../toolbar/LinkRailSection';
import { openLinkComposerFor } from '../link/openLinkComposer';
import { notify } from '../../engine/ui/notices';
import { SHORTCUTS } from './shortcuts';

/**
 * Every command the board offers on a selection, as one list.
 *
 * ## One list, two doors
 *
 * Right-click and the rail's overflow button used to be two hand-kept lists
 * that had drifted into two different products: the menu had Copy as PNG and
 * Group but no Flip; the overflow had Flip and Outline stroke but no Group, no
 * Copy, no Export; the menu's Bring to front scrambled a selection's order and
 * the overflow's did not. Which commands existed depended on which door you
 * came in by.
 *
 * FigJam's answer is the one taken here: the `⋯` on the contextual toolbar
 * opens *the same menu* as a right-click. One list, built once, in one order.
 *
 * ## The order
 *
 * Specific before general, and destructive last. What only this selection can
 * do leads — edit a table's cells, reshape a line, swap a shape — because it is
 * the reason the menu was opened more often than Copy is. The clipboard row
 * follows as icons, the way Windows 11's menus set Cut, Copy and Paste: four
 * commands everybody already knows by shape, taking one row instead of four.
 * Style, arrangement and structure come next, then the ways out of the board
 * (copy as, export), and Delete alone at the end behind a rule.
 */

export interface CanvasContextMenuActions {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  duplicate: () => void;
  remove: () => void;
  restack: (op: RestackOp) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  selectAll: () => void;
  selectAllOfType: () => void;
  selectMatching: (mode: 'kind' | 'style') => void;
  /**
   * Copy and export take the ids the *menu* is about, not the live selection:
   * right-clicking bare board leaves the selection intact, so the two are
   * routinely different and the label must describe what the file will hold.
   */
  copyPng: (ids: string[]) => void;
  copySvg: (ids: string[]) => void;
  exportSelection: (ids: string[]) => void;
  copyMermaid: () => void;
  editMermaid: () => void;
  swapShape: (kind: ShapeKind, points?: number) => void;
  group: () => void;
  ungroup: () => void;
  'break-apart': () => void;
  fillGrid: () => void;
  releaseFromGrid: () => void;
  'to-path': () => void;
  outlineStroke: () => void;
  editLinePoints: () => void;
  align: (edge: AlignEdge) => void;
  distribute: (axis: DistributeAxis) => void;
  flip: (axis: 'horizontal' | 'vertical') => void;
  toggleLock: () => void;
  hide: () => void;
  copyStyle: () => void;
  pasteStyle: () => void;
  comment: () => void;
  zoomToSelection: () => void;
  zoomToFit: () => void;
  zoomReset: () => void;
  addSticky: () => void;
  addText: () => void;
  addShape: (preset: ShapePreset) => void;
  addComment: () => void;
  importCsvTable: () => void;
  /** Open the diagram editor on this Mermaid source, ready to add to the board. */
  renderDiagram: (source: string) => void;
  addCode: () => void;
  addLink: () => void;
}

export interface CanvasMenuInput {
  nodes: AnyNode[];
  allObjects: Record<string, AnyNode>;
  actions: CanvasContextMenuActions;
  canEdit: boolean;
  style: StyleSnapshot | null;
  /** Whether this was opened at a spot on the board, which "here" refers to. */
  atPointer: boolean;
}

const I = 15;

const ALIGN: Array<{ edge: AlignEdge; label: string; icon: React.ReactNode }> = [
  { edge: 'left', label: 'Align left', icon: <AlignStartVertical size={I} /> },
  { edge: 'centerX', label: 'Align horizontal centres', icon: <AlignCenterVertical size={I} /> },
  { edge: 'right', label: 'Align right', icon: <AlignEndVertical size={I} /> },
  { edge: 'top', label: 'Align top', icon: <AlignStartHorizontal size={I} /> },
  { edge: 'middleY', label: 'Align vertical centres', icon: <AlignCenterHorizontal size={I} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignEndHorizontal size={I} /> },
];

/** Types a flip means something for: the ones drawn from geometry. */
const FLIPPABLE = new Set(['shape', 'path', 'image']);

/** Put text on the clipboard and say so — the menu has closed, so nothing else will. */
function copyText(text: string, what: string): void {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => notify(`Copied ${what}`))
    .catch(() => notify({ message: `Could not copy ${what}`, tone: 'error' }));
}

/**
 * What a code block adds to the top of its menu.
 *
 * The rail's decisions again — language, theme, wrap, fold — plus the ones too
 * rare for the rail: take the code away as a file or as Markdown. Language and
 * theme are submenus rather than rows because each is one choice among many,
 * and the ticked row says which is current without opening anything else.
 */
function codeEntries(node: CodeNode, a: CanvasContextMenuActions): MenuEntry[] {
  const { code } = node;
  const lines = code.source.split('\n').length;
  const language = languageById(code.language);
  return [
    {
      kind: 'item',
      id: 'code-edit',
      label: 'Edit code',
      icon: <SquarePen size={I} />,
      shortcut: 'Enter',
      detail: 'Or double-click the block',
      onSelect: () => useStore.getState().setCodeEditNodeId(node.id),
    },
    {
      kind: 'submenu',
      id: 'code-language',
      label: 'Language',
      icon: <Languages size={I} />,
      detail: code.detected ? `${language.label}, detected` : language.label,
      entries: languageMenuEntries(code.language, Boolean(code.detected), (pick) => pickCodeLanguage(node, pick)),
    },
    {
      kind: 'submenu',
      id: 'code-theme',
      label: 'Theme',
      icon: <Palette size={I} />,
      detail: CODE_THEMES[code.theme].label,
      entries: CODE_THEME_IDS.map((id) => ({
        kind: 'item' as const,
        id: `theme-${id}`,
        label: CODE_THEMES[id].label,
        icon: (
          <span
            className="menu__swatch"
            aria-hidden="true"
            style={{ background: `linear-gradient(135deg, ${CODE_THEMES[id].background} 50%, ${CODE_THEMES[id].tokens.keyword} 50%)` }}
          />
        ),
        checked: code.theme === id,
        onSelect: () => updateCode(node, { theme: id }),
      })),
    },
    {
      kind: 'item',
      id: 'code-wrap',
      label: 'Wrap long lines',
      icon: <WrapText size={I} />,
      checked: code.wrap,
      keepOpen: true,
      onSelect: () => updateCode(node, { wrap: !code.wrap }),
    },
    {
      kind: 'item',
      id: 'code-numbers',
      label: 'Line numbers',
      icon: <ListOrdered size={I} />,
      checked: code.lineNumbers,
      keepOpen: true,
      onSelect: () => updateCode(node, { lineNumbers: !code.lineNumbers }),
    },
    (lines > FOLD_AT || code.maxLines !== null) && {
      kind: 'item',
      id: 'code-fold',
      label: code.maxLines ? `Show all ${lines} lines` : `Fold to ${FOLD_AT} lines`,
      icon: code.maxLines ? <UnfoldVertical size={I} /> : <FoldVertical size={I} />,
      onSelect: () => updateCode(node, { maxLines: code.maxLines ? null : FOLD_AT }),
    },
    {
      kind: 'item',
      id: 'code-download',
      label: `Download ${codeFilename(code)}`,
      icon: <FileDown size={I} />,
      disabledReason: code.source.trim() ? undefined : 'There is no code to download yet',
      onSelect: () => downloadCode(code),
    },
    code.language === 'mermaid' && code.source.trim() !== '' && {
      kind: 'item',
      id: 'code-diagram',
      label: 'Render as diagram',
      icon: <Workflow size={I} />,
      detail: 'Draw this Mermaid as shapes and arrows',
      onSelect: () => a.renderDiagram(code.source),
    },
  ].filter(Boolean) as MenuEntry[];
}

/**
 * What a link card adds to the top of its menu: where it goes, and how it shows.
 *
 * Open leads because it is what a person most often right-clicks a link for.
 * The displays are a ticked submenu showing the layout the card is using right
 * now, the same answer the rail's pressed button gives.
 */
function linkEntries(node: LinkNode): MenuEntry[] {
  const { link } = node;
  const provider = providerFor(link.url);
  const shown = resolveDisplay(link.display, node.width, node.height, Boolean(provider.embed));
  const displays: Array<Exclude<LinkDisplay, 'auto'>> = provider.embed
    ? ['compact', 'horizontal', 'vertical', 'embed']
    : ['compact', 'horizontal', 'vertical'];
  return [
    shown === 'embed' && provider.embed && {
      kind: 'item',
      id: 'link-play',
      label: 'Play here',
      icon: <Play size={I} />,
      shortcut: 'Enter',
      detail: 'Or double-click the player',
      onSelect: () => useStore.getState().setEmbedActiveNodeId(node.id),
    },
    {
      kind: 'item',
      id: 'link-open',
      label: provider.id === 'web' ? 'Open link' : `Open in ${provider.name}`,
      icon: <ExternalLink size={I} />,
      shortcut: shown === 'embed' && provider.embed ? undefined : 'Enter',
      detail: siteDomain(link.url),
      onSelect: () => openLink(link.url),
    },
    {
      kind: 'submenu',
      id: 'link-display',
      label: 'Show as',
      icon: <LinkDisplayIcon display={shown} />,
      detail: LINK_DISPLAY_LABELS[shown],
      entries: displays.map((d) => ({
        kind: 'item' as const,
        id: `display-${d}`,
        label: LINK_DISPLAY_LABELS[d],
        icon: <LinkDisplayIcon display={d} />,
        checked: shown === d,
        onSelect: () => setLinkDisplay(node, d),
      })),
    },
    {
      kind: 'item',
      id: 'link-edit',
      label: 'Edit link…',
      icon: <PencilLine size={I} />,
      onSelect: () => openLinkComposerFor(node),
    },
    {
      kind: 'item',
      id: 'link-refresh',
      label: link.status === 'error' ? 'Try the preview again' : 'Refresh preview',
      icon: <RotateCw size={I} />,
      disabledReason: link.status === 'loading' ? 'The preview is still loading' : undefined,
      onSelect: () => refreshPreview(node),
    },
  ].filter(Boolean) as MenuEntry[];
}



export function selectionMenu(input: CanvasMenuInput): MenuEntry[] {
  const { nodes, allObjects, actions: a, canEdit, style, atPointer } = input;
  const ids = nodes.map((n) => n.id);
  const single = nodes.length === 1 ? nodes[0] : null;
  const offered = new Set(
    resolveAffordances(nodes, { surface: 'menu', allObjects }).map((x) => x.id)
  );
  const allLocked = nodes.every((n) => n.locked);
  const allHidden = nodes.every((n) => n.hidden);
  const uniformType = nodes.every((n) => n.type === nodes[0].type) ? nodes[0].type : null;

  // What only this selection can do.
  const table = single?.type === 'table' ? single : null;
  const code = single?.type === 'code' ? single : null;
  const link = single?.type === 'link' ? single : null;
  const shapes = nodes.every((n) => n.type === 'shape') ? (nodes as Extract<AnyNode, { type: 'shape' }>[]) : null;
  const closedShapes = shapes?.every((n) => !isOpenShape(n.geometry.kind)) ? shapes : null;
  const openShapes = shapes?.every((n) => isOpenShape(n.geometry.kind)) ? shapes : null;
  const diagramParts = nodes.filter((n) => n.type === 'shape' || n.type === 'connector');
  const isDiagram = nodes.some((n) => n.type === 'shape');
  const dropped = nodes.length - diagramParts.length;
  const strokeWidth = single && 'appearance' in single ? single.appearance?.stroke?.width ?? 0 : 0;

  const styleFits = canPasteStyle(nodes, style);
  const pasteStyleReason = !style
    ? 'Copy a style from another object first'
    : !styleFits
      ? `Nothing here can take a ${kindNoun({ type: style.sourceType } as AnyNode, false)}’s style`
      : undefined;

  const specific: MenuEntry[] = canEdit
    ? [
        table && {
          kind: 'item',
          id: 'table-edit',
          label: 'Edit cells',
          icon: <TextCursorInput size={I} />,
          detail: 'Or double-click the table',
          onSelect: () => useStore.getState().setTableEditNodeId(table.id),
        },
        table && {
          kind: 'item',
          id: 'table-fit',
          label: 'Fit columns to content',
          icon: <UnfoldHorizontal size={I} />,
          onSelect: () => fitTableColumns(table),
        },
        table && {
          kind: 'submenu',
          id: 'table-csv',
          label: 'CSV',
          icon: <Table2 size={I} />,
          entries: [
            { kind: 'item', id: 'csv-import', label: 'Import CSV…', icon: <FileUp size={I} />, onSelect: () => void importCsvIntoTable(table) },
            { kind: 'item', id: 'csv-export', label: 'Download as CSV', icon: <FileDown size={I} />, onSelect: () => exportTableCsv(table.table) },
          ],
        },
        ...(code ? codeEntries(code, a) : []),
        ...(link ? linkEntries(link) : []),
        offered.has('line-vertices') && {
          kind: 'item',
          id: 'line-vertices',
          label: 'Edit points',
          icon: <Spline size={I} />,
          shortcut: SHORTCUTS.editPoints,
          onSelect: a.editLinePoints,
        },
        closedShapes && {
          kind: 'submenu',
          id: 'swap-shape',
          label: closedShapes.length === 1 ? 'Change shape' : `Change ${closedShapes.length} shapes`,
          icon: <Shapes size={I} />,
          panel: (close: () => void) => (
            <ShapeSwapPanel
              value={
                closedShapes.every((n) => presetForGeometry(n.geometry) === presetForGeometry(closedShapes[0].geometry))
                  ? presetForGeometry(closedShapes[0].geometry)
                  : null
              }
              onPick={(preset) => {
                const recipe = SHAPE_BY_PRESET[preset].geometry;
                a.swapShape(recipe.kind, recipe.points);
                close();
              }}
            />
          ),
        },
        openShapes && {
          kind: 'submenu',
          id: 'swap-line',
          label: 'Change line',
          icon: <Shapes size={I} />,
          entries: SHAPE_CHOICES.filter((c) => isOpenShape(c.kind)).map((c) => ({
            kind: 'item' as const,
            id: `swap-${c.preset}`,
            label: c.label,
            icon: c.icon,
            disabled: openShapes.every((n) => n.geometry.kind === c.kind),
            onSelect: () => a.swapShape(c.kind, c.points),
          })),
        },
        offered.has('grid-slot') && {
          kind: 'item',
          id: 'grid-slot',
          label: nodes.length === 1 ? 'Remove from grid' : `Remove ${nodes.length} from grid`,
          icon: <ImageOff size={I} />,
          onSelect: a.releaseFromGrid,
        },
        offered.has('grid-fill') && {
          kind: 'item',
          id: 'grid-fill',
          label: (() => {
            const count = nodes.filter((n) => n.type === 'image').length;
            return count === 1 ? 'Place image in grid' : `Place ${count} images in grid`;
          })(),
          icon: <ImagePlus size={I} />,
          onSelect: a.fillGrid,
        },
        offered.has('break-apart') && {
          kind: 'item',
          id: 'break-apart',
          label: 'Break apart',
          icon: <Ungroup size={I} />,
          detail: 'Turn the modules into editable shapes',
          onSelect: a['break-apart'],
        },
        isDiagram && {
          kind: 'item',
          id: 'edit-mermaid',
          label: 'Edit as Mermaid…',
          icon: <Code2 size={I} />,
          detail: dropped > 0 ? `${diagramParts.length} of ${nodes.length} objects are boxes and arrows` : undefined,
          onSelect: a.editMermaid,
        },
        (offered.has('to-path') || (single && canVectorize(single) && strokeWidth > 0)) && {
          kind: 'submenu',
          id: 'vector',
          label: 'Vector',
          icon: <PenTool size={I} />,
          entries: [
            offered.has('to-path') && {
              kind: 'item',
              id: 'to-path',
              label: single?.type === 'text' ? 'Outline text' : 'Convert to path',
              icon: <PenTool size={I} />,
              onSelect: a['to-path'],
            },
            single && canVectorize(single) && strokeWidth > 0 && {
              kind: 'item',
              id: 'outline-stroke',
              label: 'Outline stroke',
              icon: <Scissors size={I} />,
              onSelect: a.outlineStroke,
            },
          ].filter(Boolean) as MenuEntry[],
        },
      ].filter(Boolean) as MenuEntry[]
    : [];

  const clipboard: MenuEntry = {
    kind: 'strip',
    id: 'clipboard',
    label: 'Clipboard',
    items: [
      { id: 'cut', label: 'Cut', icon: <Scissors size={I} />, shortcut: SHORTCUTS.cut, disabled: !canEdit, onSelect: a.cut },
      { id: 'copy', label: 'Copy', icon: <Copy size={I} />, shortcut: SHORTCUTS.copy, onSelect: a.copy },
      { id: 'paste', label: atPointer ? 'Paste here' : 'Paste', icon: <ClipboardPaste size={I} />, shortcut: SHORTCUTS.paste, disabled: !canEdit, onSelect: a.paste },
      { id: 'duplicate', label: 'Duplicate', icon: <CopyPlus size={I} />, shortcut: SHORTCUTS.duplicate, disabled: !canEdit, onSelect: a.duplicate },
    ],
  };

  const styleRows: MenuEntry[] = canEdit
    ? [
        single
          ? { kind: 'item', id: 'copy-style', label: 'Copy style', icon: <Paintbrush size={I} />, shortcut: SHORTCUTS.copyStyle, onSelect: a.copyStyle }
          : null,
        {
          kind: 'item',
          id: 'paste-style',
          label: 'Paste style',
          icon: <PaintRoller size={I} />,
          shortcut: SHORTCUTS.pasteStyle,
          disabled: !styleFits,
          disabledReason: pasteStyleReason,
          trailing: styleFits ? <StyleSwatch color={style?.swatch ?? null} /> : undefined,
          onSelect: a.pasteStyle,
        },
      ].filter(Boolean) as MenuEntry[]
    : [];

  const arrange: MenuEntry[] = canEdit
    ? [
        offered.has('align') && { kind: 'heading', id: 'align-heading', label: 'Align' },
        offered.has('align') && {
          kind: 'strip',
          id: 'align',
          label: 'Align',
          items: [
            ...ALIGN.map(({ edge, label, icon }) => ({ id: edge, label, icon, onSelect: () => a.align(edge) })),
            ...(offered.has('distribute')
              ? [
                  { id: 'dist-h', label: 'Distribute horizontally', icon: <AlignHorizontalSpaceAround size={I} />, onSelect: () => a.distribute('horizontal') },
                  { id: 'dist-v', label: 'Distribute vertically', icon: <AlignVerticalSpaceAround size={I} />, onSelect: () => a.distribute('vertical') },
                ]
              : []),
          ],
        },
        offered.has('align') && { kind: 'separator', id: 'sep-align' },
        offered.has('order') && {
          kind: 'submenu',
          id: 'order',
          label: 'Order',
          icon: <Layers size={I} />,
          entries: [
            { kind: 'item', id: 'front', label: 'Bring to front', icon: <ArrowUpToLine size={I} />, shortcut: SHORTCUTS.front, onSelect: () => a.restack('front') },
            { kind: 'item', id: 'forward', label: 'Bring forward', icon: <ArrowUp size={I} />, shortcut: SHORTCUTS.forward, onSelect: () => a.restack('forward') },
            { kind: 'item', id: 'backward', label: 'Send backward', icon: <ArrowDown size={I} />, shortcut: SHORTCUTS.backward, onSelect: () => a.restack('backward') },
            { kind: 'item', id: 'back', label: 'Send to back', icon: <ArrowDownToLine size={I} />, shortcut: SHORTCUTS.back, onSelect: () => a.restack('back') },
          ],
        },
        nodes.every((n) => FLIPPABLE.has(n.type)) && {
          kind: 'submenu',
          id: 'flip',
          label: 'Flip',
          icon: <FlipHorizontal2 size={I} />,
          entries: [
            { kind: 'item', id: 'flip-h', label: 'Flip horizontal', icon: <FlipHorizontal2 size={I} />, onSelect: () => a.flip('horizontal') },
            { kind: 'item', id: 'flip-v', label: 'Flip vertical', icon: <FlipVertical2 size={I} />, onSelect: () => a.flip('vertical') },
          ],
        },
        offered.has('ungroup')
          ? { kind: 'item', id: 'ungroup', label: 'Ungroup', icon: <Ungroup size={I} />, shortcut: SHORTCUTS.ungroup, onSelect: a.ungroup }
          : offered.has('group') && { kind: 'item', id: 'group', label: 'Group', icon: <Group size={I} />, shortcut: SHORTCUTS.group, onSelect: a.group },
        offered.has('lock') && {
          kind: 'item',
          id: 'lock',
          // Says which way it will go: a toggle named for itself makes you look
          // at the object to find out what pressing it does.
          label: allLocked ? 'Unlock' : 'Lock',
          icon: allLocked ? <Unlock size={I} /> : <Lock size={I} />,
          shortcut: SHORTCUTS.lock,
          onSelect: a.toggleLock,
        },
        offered.has('visibility') && {
          kind: 'item',
          id: 'visibility',
          label: allHidden ? 'Show' : 'Hide',
          icon: allHidden ? <Eye size={I} /> : <EyeOff size={I} />,
          shortcut: SHORTCUTS.hide,
          onSelect: a.hide,
        },
      ].filter(Boolean) as MenuEntry[]
    : [];

  const noun = uniformType ? kindNoun(nodes[0], true) : null;
  const find: MenuEntry[] = [
    {
      kind: 'submenu',
      id: 'select',
      label: 'Select',
      icon: <MousePointerSquareDashed size={I} />,
      entries: [
        noun && {
          kind: 'item',
          id: 'select-kind',
          // A shape matches on its geometry — rectangles with rectangles — so
          // "All shapes" would promise more than it selects.
          label: uniformType === 'shape' ? 'Same shape' : `All ${noun}`,
          icon: <MousePointerSquareDashed size={I} />,
          onSelect: () => a.selectMatching('kind'),
        },
        noun && {
          kind: 'item',
          id: 'select-style',
          label: 'Matching style',
          detail: `${noun[0].toUpperCase()}${noun.slice(1)} painted the same way`,
          icon: <Paintbrush size={I} />,
          onSelect: () => a.selectMatching('style'),
        },
        { kind: 'item', id: 'select-all', label: 'Everything', icon: <Scan size={I} />, shortcut: SHORTCUTS.selectAll, onSelect: a.selectAll },
      ].filter(Boolean) as MenuEntry[],
    },
    { kind: 'item', id: 'zoom-selection', label: 'Zoom to selection', icon: <Focus size={I} />, shortcut: SHORTCUTS.zoomSelection, onSelect: a.zoomToSelection },
    single && { kind: 'item', id: 'comment', label: 'Comment', icon: <MessageSquarePlus size={I} />, onSelect: a.comment },
  ].filter(Boolean) as MenuEntry[];

  const out: MenuEntry[] = [
    {
      kind: 'submenu',
      id: 'copy-as',
      label: 'Copy as',
      icon: <Copy size={I} />,
      entries: [
        { kind: 'item', id: 'png', label: 'PNG image', icon: <ImageDown size={I} />, onSelect: () => a.copyPng(ids) },
        { kind: 'item', id: 'svg', label: 'SVG', icon: <FileCode2 size={I} />, onSelect: () => a.copySvg(ids) },
        isDiagram && {
          kind: 'item',
          id: 'mermaid',
          label: 'Mermaid',
          icon: <Workflow size={I} />,
          // Said on the row, not discovered in the pasted text afterwards.
          detail:
            dropped > 0
              ? `${diagramParts.length} of ${nodes.length}: ${dropped === 1 ? 'one is' : `${dropped} are`} not boxes or arrows`
              : undefined,
          onSelect: a.copyMermaid,
        },
        table && { kind: 'item', id: 'csv', label: 'CSV', icon: <Table2 size={I} />, onSelect: () => void copyTableCsv(table.table) },
        code && { kind: 'separator', id: 'sep-code' },
        code && { kind: 'item', id: 'code-text', label: 'Code', icon: <Code2 size={I} />, detail: 'Just the text', onSelect: () => copyText(code.code.source, 'the code') },
        code && { kind: 'item', id: 'code-markdown', label: 'Markdown', icon: <FileCode2 size={I} />, detail: 'In a fenced block, language kept', onSelect: () => copyText(codeAsFence(code.code), 'as Markdown') },
        link && { kind: 'separator', id: 'sep-link' },
        link && { kind: 'item', id: 'link-address', label: 'Link address', icon: <Link2 size={I} />, onSelect: () => copyText(link.link.url, 'the link') },
        link && {
          kind: 'item',
          id: 'link-markdown',
          label: 'Markdown link',
          icon: <FileCode2 size={I} />,
          onSelect: () => copyText(`[${(link.link.meta?.title || siteDomain(link.link.url)).replace(/[[\]]/g, '')}](${link.link.url})`, 'as a Markdown link'),
        },
      ].filter(Boolean) as MenuEntry[],
    },
    { kind: 'item', id: 'export', label: 'Export…', icon: <Download size={I} />, shortcut: SHORTCUTS.export, onSelect: () => a.exportSelection(ids) },
  ];

  return tidy([
    ...specific,
    { kind: 'separator', id: 'sep-specific' },
    clipboard,
    { kind: 'separator', id: 'sep-clipboard' },
    ...styleRows,
    { kind: 'separator', id: 'sep-style' },
    ...arrange,
    { kind: 'separator', id: 'sep-arrange' },
    ...find,
    { kind: 'separator', id: 'sep-find' },
    ...out,
    { kind: 'separator', id: 'sep-out' },
    canEdit && offered.has('delete') && {
      kind: 'item',
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={I} />,
      shortcut: SHORTCUTS.delete,
      danger: true,
      onSelect: a.remove,
    },
  ]);
}



export function boardMenu(input: CanvasMenuInput): MenuEntry[] {
  const { actions: a, canEdit, atPointer, allObjects } = input;
  const empty = Object.keys(allObjects).length === 0;
  const here = atPointer ? ' here' : '';

  return tidy([
    canEdit && { kind: 'heading', id: 'add-heading', label: atPointer ? 'Add here' : 'Add' },
    canEdit && {
      kind: 'strip',
      id: 'add',
      label: `Add${here}`,
      items: [
        { id: 'note', label: `Note${here}`, icon: <StickyNote size={I} />, onSelect: a.addSticky },
        { id: 'text', label: `Text${here}`, icon: <Type size={I} />, onSelect: a.addText },
        { id: 'code', label: `Code block${here}`, icon: <Code2 size={I} />, onSelect: a.addCode },
        { id: 'link', label: `Link${here}`, icon: <Link2 size={I} />, onSelect: a.addLink },
        { id: 'comment', label: `Comment${here}`, icon: <MessageSquarePlus size={I} />, onSelect: a.addComment },
      ],
    },
    canEdit && {
      kind: 'submenu',
      id: 'add-shape',
      label: 'Shape',
      icon: <Shapes size={I} />,
      panel: (close) => (
        <AddShapePanel
          onPick={(preset) => {
            close();
            a.addShape(preset);
          }}
        />
      ),
    },
    { kind: 'separator', id: 'sep-add' },
    canEdit && {
      kind: 'item',
      id: 'paste',
      label: `Paste${here}`,
      icon: <ClipboardPaste size={I} />,
      shortcut: SHORTCUTS.paste,
      onSelect: a.paste,
    },
    {
      kind: 'item',
      id: 'select-all',
      label: 'Select all',
      icon: <MousePointerSquareDashed size={I} />,
      shortcut: SHORTCUTS.selectAll,
      disabled: empty,
      onSelect: a.selectAll,
    },
    { kind: 'separator', id: 'sep-edit' },
    {
      kind: 'item',
      id: 'zoom-fit',
      label: 'Zoom to fit',
      icon: <Maximize size={I} />,
      shortcut: SHORTCUTS.zoomFit,
      disabled: empty,
      onSelect: a.zoomToFit,
    },
    { kind: 'item', id: 'zoom-reset', label: 'Zoom to 100%', icon: <Focus size={I} />, shortcut: SHORTCUTS.zoomReset, onSelect: a.zoomReset },
    { kind: 'separator', id: 'sep-view' },
    canEdit && { kind: 'item', id: 'csv-table', label: 'Import CSV as table…', icon: <Table2 size={I} />, onSelect: a.importCsvTable },
    {
      kind: 'submenu',
      id: 'copy-board',
      label: 'Copy board as',
      icon: <Copy size={I} />,
      disabled: empty,
      entries: [
        { kind: 'item', id: 'png', label: 'PNG image', icon: <ImageDown size={I} />, onSelect: () => a.copyPng([]) },
        { kind: 'item', id: 'svg', label: 'SVG', icon: <FileCode2 size={I} />, onSelect: () => a.copySvg([]) },
      ],
    },
    {
      kind: 'item',
      id: 'export',
      label: 'Export board…',
      icon: <Download size={I} />,
      shortcut: SHORTCUTS.export,
      disabled: empty,
      onSelect: () => a.exportSelection([]),
    },
  ]);
}
