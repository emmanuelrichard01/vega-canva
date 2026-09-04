import type { ChartSeries, ChartSpec } from './chartTypes';

/**
 * A chart's data as delimited text, and back.
 *
 * ## Why this is the important half of the feature
 *
 * Nobody types thirty numbers into a panel. The data already exists — in a
 * spreadsheet, a query result, a dashboard — and the distance between "I have
 * numbers" and "there is a chart on the board" is a paste. Everything else the
 * chart section offers is styling on top of data that has to arrive somehow,
 * and this is how it arrives.
 *
 * ## Tabs and commas, read the same way
 *
 * Copying a range out of Excel, Sheets or Numbers puts **tab**-separated text
 * on the clipboard; a `.csv` file is comma-separated. Asking which one the
 * user has is asking them to know something about their clipboard that they
 * have no way to check, so the delimiter is *detected*: whichever of tab or
 * comma appears more often in the header row wins. A header of
 * `Region,Q1,Q2` has two commas and no tabs; the same range copied from a
 * sheet has two tabs and no commas. They are never ambiguous in practice, and
 * the tie goes to comma because that is what a file is.
 *
 * ## Quoting
 *
 * RFC 4180 quoting is honoured on read — `"Smith, John"` is one field, and a
 * doubled `""` is a literal quote — because a category containing a comma is
 * completely ordinary and silently splitting it produces a chart with an extra
 * column and every value shifted under the wrong label. On write, a field is
 * quoted only when it needs to be, so the common output stays diff-friendly.
 */

export type Delimiter = ',' | '\t';

/** Whichever delimiter the first line actually uses. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let commas = 0;
  let tabs = 0;
  let inQuotes = false;

  for (let i = 0; i < firstLine.length; i += 1) {
    const c = firstLine[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === ',') commas += 1;
    else if (!inQuotes && c === '\t') tabs += 1;
  }
  return tabs > commas ? '\t' : ',';
}

/**
 * Split delimited text into rows of fields, honouring quotes.
 *
 * Written as a scanner rather than `split(delimiter)` because a split cannot
 * see quoting, and cannot see that a newline inside quotes is part of a field
 * rather than the end of a row. Both appear in real exports.
 */
export function parseDelimited(text: string, delimiter?: Delimiter): string[][] {
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty row, which is not a row of data.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && field === '') inQuotes = true;
    else if (c === d) endField();
    else if (c === '\n') endRow();
    else if (c === '\r') {
      // CRLF: the \n that follows does the work.
      if (text[i + 1] !== '\n') endRow();
    } else field += c;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * A number, or `null` for a hole.
 *
 * Tolerant of the things spreadsheets actually emit: thousands separators,
 * currency symbols, a trailing per cent, parentheses for negatives, and
 * whitespace. **Not** tolerant of a value it cannot read, which becomes a hole
 * rather than a zero — the distinction the whole data model rests on. A cell
 * reading `N/A` is a missing reading, and turning it into `0` would draw a
 * measured crash to nothing.
 */
export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;

  // (1,234) is how a spreadsheet writes -1234.
  const negated = /^\((.*)\)$/.test(s);
  const body = negated ? s.slice(1, -1) : s;

  const cleaned = body.replace(/[,\s]/g, '').replace(/^[^\d.\-+]+/, '').replace(/%$/, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negated ? -n : n;
}

export interface ParsedChartData {
  categories: string[];
  series: ChartSeries[];
}

/**
 * Read a table into categories and series.
 *
 * The shape assumed is the one every spreadsheet produces: a header row whose
 * first cell is the category column's name and whose remaining cells are
 * series names, then one row per category. Anything that does not parse as a
 * number is a hole.
 *
 * **The header is detected, not assumed.** A table whose second row onward is
 * numeric but whose first row is not is a table with a header; one that is
 * numeric from the very first row has none, and inventing one would eat a row
 * of real data. That check is what stops a paste of bare numbers losing its
 * first reading.
 */
export function parseChartData(text: string): ParsedChartData {
  const rows = parseDelimited(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) return { categories: [], series: [] };

  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');

  const first = pad(rows[0]);
  // A header row is one whose value cells are not numbers.
  const looksLikeHeader =
    width > 1 && first.slice(1).some((c) => c.trim() !== '' && parseNumber(c) === null);

  const header = looksLikeHeader ? first : null;
  const body = (looksLikeHeader ? rows.slice(1) : rows).map(pad);

  const seriesCount = Math.max(1, width - 1);
  const series: ChartSeries[] = Array.from({ length: seriesCount }, (_, s) => ({
    name: header?.[s + 1]?.trim() || `Series ${s + 1}`,
    values: body.map((r) => parseNumber(r[s + 1] ?? '')),
  }));

  return {
    categories: body.map((r, i) => r[0]?.trim() || `Item ${i + 1}`),
    series,
  };
}

/** Quote a field only when it would otherwise be misread. */
function quote(field: string, d: Delimiter): string {
  return field.includes(d) || field.includes('"') || /[\r\n]/.test(field)
    ? `"${field.replace(/"/g, '""')}"`
    : field;
}

/**
 * A chart's data as CSV, header row included.
 *
 * A hole is written as an **empty cell**, not as `0` or `null` — so a round
 * trip out to a spreadsheet and back preserves the one distinction the model
 * cares about. Writing `0` would silently convert every gap into a reading on
 * the way out, and no amount of care on the way back in could recover it.
 */
export function chartToCsv(spec: ChartSpec, delimiter: Delimiter = ','): string {
  const lines: string[] = [];
  const head = ['Category', ...spec.series.map((s) => s.name)];
  lines.push(head.map((h) => quote(h, delimiter)).join(delimiter));

  spec.categories.forEach((category, i) => {
    const cells = [
      quote(category, delimiter),
      ...spec.series.map((s) => {
        const v = s.values[i];
        return typeof v === 'number' ? String(v) : '';
      }),
    ];
    lines.push(cells.join(delimiter));
  });

  return lines.join('\n');
}

/**
 * Replace a chart's data, keeping everything about how it is drawn.
 *
 * Pasting new numbers must not reset the kind, the title, the palette or the
 * axis bounds — those are decisions about presentation that the author made
 * and the clipboard knows nothing about. The one exception is a series colour
 * the author set explicitly: it is carried across positionally, so re-pasting
 * an updated version of the same table keeps the colours it was given.
 */
export function withChartData(spec: ChartSpec, data: ParsedChartData): ChartSpec {
  return {
    ...spec,
    categories: data.categories,
    series: data.series.map((s, i) => {
      const existing = spec.series[i];
      return existing?.color ? { ...s, color: existing.color } : s;
    }),
  };
}

/**
 * Hand a chart's data to the browser as a `.csv` file.
 *
 * ## Why this does not reuse `ExportService.save`
 *
 * It would be the same eight lines, and importing it costs the whole export
 * subsystem. `exportChunking.test.ts` holds `engine/export/` out of the bundle
 * every board loads — `app-export` is 261KB of PDF writer, SVG serialiser and
 * image pipeline — and it counts *dynamic* references too, so an `await
 * import()` is refused as well. The test caught this on the first attempt,
 * which is the whole reason it exists.
 *
 * The deeper reason is that this is not an export in the sense that module
 * means. "Export" there is rendering the board to a picture; this is handing
 * back the numbers that were typed in. Filing it under the image pipeline
 * would put "Export CSV" in a menu of six raster formats, where it would read
 * as a seventh.
 *
 * The object URL is revoked on the *next frame* rather than immediately: the
 * navigation to the blob is queued by `click()` and not yet started, and
 * revoking synchronously is a race some browsers lose, producing a download
 * that silently fails. That detail is learned from `ExportService.save`, which
 * carries the same comment.
 */
export function downloadCsv(spec: ChartSpec, filename: string): void {
  if (typeof document === 'undefined') return;

  // The BOM is not decoration: without it Excel opens a UTF-8 CSV using the
  // system codepage, and every non-ASCII category name arrives mangled.
  const blob = new Blob(['﻿', chartToCsv(spec)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/**
 * A filename stem from a chart's title.
 *
 * A local slug rather than `engine/export/filenames`, for the reason above:
 * that module is inside the lazy chunk. Kept deliberately strict — a
 * downloaded file lands in a folder shared with everything else on the
 * machine, and a name with a slash or a colon in it fails differently on every
 * operating system.
 */
export function csvFilename(title: string | undefined): string {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'chart';
}
