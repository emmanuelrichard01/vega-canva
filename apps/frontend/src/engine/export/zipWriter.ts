import { crc32 } from './crc32';

/**
 * A ZIP archive, stored rather than compressed.
 *
 * Batch export hands back one file per frame, and a browser asked to save
 * twelve downloads in a row either prompts twelve times or blocks all but the
 * first. One archive is one download. The entries are PNG, JPEG, WebP, PDF
 * and SVG — the first four already compressed, so deflating them again saves
 * almost nothing — which is why "store" (method 0) is the whole of what this
 * needs: a local header and the bytes per entry, then a central directory
 * and its end record. No dependency, about a hundred lines, readable by every
 * unzip tool and by the operating systems' own.
 *
 * Names are written as UTF-8 with general-purpose bit 11 set, so a frame
 * called "設計レビュー" arrives under its own name rather than as mojibake.
 * Limits are the classic format's: under 65,535 entries and 4 GiB in all,
 * which a browser could not hold in memory anyway.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Modification time written into the entry. Defaults to now. */
  date?: Date;
}

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/** MS-DOS time and date words, which is what the format stores. Before 1980 is written as 1980. */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** The archive's bytes. Throws if it would exceed what the format can address. */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new Error(`A ZIP holds at most ${MAX_ENTRIES} files.`);
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    return { name, data: entry.data, crc: crc32(entry.data), stamp: dosDateTime(entry.date ?? new Date()) };
  });

  const localSize = prepared.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
  const centralSize = prepared.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const total = localSize + centralSize + 22;
  if (localSize > MAX_BYTES) throw new Error('These files are too large to put in one ZIP. Export fewer frames at a time.');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];

  const u16 = (v: number) => { view.setUint16(at, v, true); at += 2; };
  const u32 = (v: number) => { view.setUint32(at, v >>> 0, true); at += 4; };

  for (const e of prepared) {
    offsets.push(at);
    u32(0x04034b50); // local file header
    u16(20); // version needed: 2.0
    u16(0x0800); // flags: UTF-8 names
    u16(0); // method: stored
    u16(e.stamp.time);
    u16(e.stamp.date);
    u32(e.crc);
    u32(e.data.length); // compressed size
    u32(e.data.length); // uncompressed size
    u16(e.name.length);
    u16(0); // extra length
    out.set(e.name, at); at += e.name.length;
    out.set(e.data, at); at += e.data.length;
  }

  const centralStart = at;
  prepared.forEach((e, i) => {
    u32(0x02014b50); // central directory header
    u16(20); // version made by
    u16(20); // version needed
    u16(0x0800);
    u16(0);
    u16(e.stamp.time);
    u16(e.stamp.date);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]);
    out.set(e.name, at); at += e.name.length;
  });

  const centralLength = at - centralStart;
  u32(0x06054b50); // end of central directory
  u16(0); // this disk
  u16(0); // disk with the directory
  u16(prepared.length);
  u16(prepared.length);
  u32(centralLength);
  u32(centralStart);
  u16(0); // comment length
  return out;
}

/** The archive as a Blob, ready to save. */
export function zipBlob(entries: readonly ZipEntry[]): Blob {
  const bytes = buildZip(entries);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' });
}
