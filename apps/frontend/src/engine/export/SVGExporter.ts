import { FORMAT_SPECS, resolveBackground, type Exporter, type ExportOptions, type ExportFormat } from './ExportTypes';
import { useStore } from '../../hooks/useStore';
import { isDarkExportBackground } from './stickyExport';
import type { AnyNode, ImageNode, TextNode } from '../model/schema';
import { readBoardSketch } from '../model/roughBoard';
import { assembleSvg } from './svgDocument';
import { fetchBlob, inlineImageSources } from './inlineImages';
import { contourData, translatePath } from '../model/pathGeometry';
import { measurerFor } from '../text/measure';
import { computeContentBounds } from './bounds';
import { exportIds, exportIdSet } from './exportScope';
import { compareStacking } from '../model/stacking';
import { familiesInNodes, fontFaceCss } from '../text/fontEmbed';
import { fontEntry } from '../text/fontCatalogue';
import { nodesToSvg, rotationTransform } from './nodesToSvg';
import { embedWebFonts } from './webFontEmbed';
import { attr } from './markup';
import { contrastInk } from '../model/color';
import { commentsWithin } from './commentPins';

const intersects = (n: AnyNode, b: { x: number; y: number; width: number; height: number }) =>
  n.x < b.x + b.width && n.x + n.width > b.x && n.y < b.y + b.height && n.y + n.height > b.y;

/** What an SVG export wrote, beyond the file itself. */
export interface SvgReport {
  svg: string;
  /** Bytes the embedded fonts add (zero when fonts were not embedded). */
  fontBytes: number;
  /** Families the file names but could not carry. */
  unembedded: string[];
  /** Text objects left as live text because their face could not be outlined. */
  notOutlined: number;
}

/**
 * Text objects as filled outlines, keyed by node id, for the ones whose face
 * can be read. Lines and advances come from `outlineText`, which takes its
 * breaks from the same layout the canvas uses.
 */
async function outlinedText(nodes: readonly AnyNode[], signal?: AbortSignal): Promise<{ markup: Map<string, string>; failed: number }> {
  const texts = nodes.filter((n): n is TextNode => n.type === 'text' && Boolean(n.text.trim()));
  const markup = new Map<string, string>();
  if (texts.length === 0) return { markup, failed: 0 };
  const { outlineText } = await import('../text/textOutline');
  let failed = 0;
  for (const node of texts) {
    if (signal?.aborted) break;
    try {
      const outlined = await outlineText(node);
      if (!outlined) continue;
      const t = node.typography;
      const ink = t.highlight?.autoContrast ? contrastInk(t.highlight.color) : t.color;
      const d = contourData(translatePath(outlined.geometry, node.x, node.y));
      markup.set(node.id, `<g${rotationTransform(node)}><path d="${d}" fill="${attr(ink)}" fill-rule="evenodd" /></g>`);
    } catch {
      failed += 1;
    }
  }
  return { markup, failed };
}

/** Uploaded and device faces are carried by `fontFaceCss`, not the web-font embedder. */
const runtimeFamily = (family: string) => {
  const source = fontEntry(family)?.source;
  return source === 'board' || source === 'local';
};

/**
 * The board, or a part of it, as an SVG file.
 *
 * The drawing is `nodesToSvg`'s; this decides what is in the file (scope,
 * hidden objects, stacking), what it sits on, and what travels inside it
 * (images, fonts).
 */
export async function renderSvg(options: ExportOptions): Promise<SvgReport> {
  const state = useStore.getState();
  let nodes = Object.values(state.objects);
  const ids = exportIdSet(options);
  if (ids) nodes = nodes.filter((n) => ids.has(n.id));
  nodes = nodes.filter((n) => !n.hidden && n.type !== 'comment').sort(compareStacking);

  // Padding moves the SVG's crop exactly as it moves the PNG's.
  const bounds = options.bounds ?? computeContentBounds(state.objects, exportIds(options) ?? undefined, options.padding);
  // A visible-area export holds only what reaches into the view.
  if (options.bounds && !ids) nodes = nodes.filter((n) => n.type === 'connector' || intersects(n, bounds));
  // Threads pinned inside the export, when asked for; nodesToSvg draws them last.
  if (options.includeComments) nodes = [...nodes, ...commentsWithin(Object.values(state.objects), bounds)];

  // Image bytes go into the file, so it is a picture wherever it is opened.
  // A source that cannot be read stays a reference.
  const { embedded: images } = await inlineImageSources(
    nodes.filter((n) => n.type === 'image').map((n) => (n as ImageNode).src ?? ''),
    fetchBlob
  );

  const background = resolveBackground(options.background, FORMAT_SPECS.svg);
  const dark = isDarkExportBackground(options.background);
  const outlines = options.outlineText ? await outlinedText(nodes, options.signal) : null;

  const { body, defs } = await nodesToSvg(nodes, {
    objects: state.objects,
    boardSketch: readBoardSketch(),
    dark,
    ground: background ?? '#FFFFFF',
    images,
    measure: measurerFor,
    includeComments: options.includeComments,
    cooperative: true,
    signal: options.signal,
    replace: outlines?.markup,
  });
  // Uploaded faces always travel; device faces when chosen; the app's own when asked.
  const runtimeCss = await fontFaceCss(familiesInNodes(nodes), { embedLocal: options.embedLocalFonts });
  const web = options.embedFonts ? await embedWebFonts(body.join(''), { skip: runtimeFamily }) : null;
  const styles = [runtimeCss, web?.css].filter(Boolean).join('\n');

  const svg = assembleSvg({ bounds, defs, background, body, styles });
  return {
    svg,
    fontBytes: web?.bytes ?? 0,
    unembedded: web?.missing ?? [],
    notOutlined: outlines?.failed ?? 0,
  };
}

export class SVGExporter implements Exporter {
  type: ExportFormat = 'svg';

  async export(options: ExportOptions): Promise<string> {
    return (await renderSvg(options)).svg;
  }
}
