import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip, dosDateTime } from './zipWriter';
import { crc32 } from './crc32';
import { cleanSuffix, exportFilename, uniqueFilenames } from './filenames';

/**
 * The archive is read back by an independent walk of the format (end record →
 * central directory → local headers), and by Python's `zipfile` where Python
 * is installed, which is a standard parser nobody here wrote.
 */

const bytes = (s: string) => new TextEncoder().encode(s);

function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirAt = view.getUint32(eocd + 16, true);
  expect(dirAt + dirSize).toBe(eocd);
  const out: Array<{ name: string; data: Uint8Array; crc: number; flags: number }> = [];
  let at = dirAt;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    expect(view.getUint32(at + 24, true)).toBe(size);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    expect(method).toBe(0);
    // The local header agrees with the directory.
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    const localName = view.getUint16(local + 26, true);
    const extra = view.getUint16(local + 28, true);
    const dataAt = local + 30 + localName + extra;
    out.push({ name, data: zip.subarray(dataAt, dataAt + size), crc, flags });
    at += 46 + nameLen;
  }
  return out;
}

describe('crc32', () => {
  it('matches the published check value and continues across chunks', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('6789'), crc32(bytes('12345')))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('buildZip', () => {
  const entries = [
    { name: 'launch-plan@2x.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: '設計レビュー.svg', data: bytes('<svg xmlns="http://www.w3.org/2000/svg"/>') },
    { name: 'empty.txt', data: new Uint8Array() },
  ];

  it('writes a central directory that points at every entry, with its bytes and checksum', () => {
    const read = readZip(buildZip(entries));
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    read.forEach((e, i) => {
      expect([...e.data]).toEqual([...entries[i].data]);
      expect(e.crc).toBe(crc32(entries[i].data));
      // UTF-8 names are flagged, so non-Latin titles survive.
      expect(e.flags & 0x0800).toBe(0x0800);
    });
  });

  it('is an empty archive with no entries', () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('stores DOS timestamps, clamping dates before 1980', () => {
    const t = dosDateTime(new Date(2026, 9, 7, 13, 45, 31));
    expect(t.date).toBe(((2026 - 1980) << 9) | (10 << 5) | 7);
    expect(t.time).toBe((13 << 11) | (45 << 5) | 15);
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });

  it('opens in Python’s zipfile, where Python is installed', () => {
    const python = ['python3', 'python'].find((cmd) => spawnSync(cmd, ['--version']).status === 0);
    if (!python) return;
    const dir = mkdtempSync(join(tmpdir(), 'vega-zip-'));
    try {
      const file = join(dir, 'frames.zip');
      writeFileSync(file, buildZip(entries));
      const script =
        'import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;' +
        'print(json.dumps([[i.filename,i.file_size] for i in z.infolist()]))';
      const run = spawnSync(python, ['-c', script, file], { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual(entries.map((e) => [e.name, e.data.length]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('batch file names', () => {
  it('names from the frame title, with the density or the preset’s own suffix', () => {
    expect(exportFilename('Launch: plan / v2', 'png', 2)).toBe('launch-plan-v2@2x.png');
    expect(exportFilename('Hero', 'png', 2, '-dark')).toBe('hero-dark.png');
    expect(exportFilename('Hero', 'png', 2, '')).toBe('hero.png');
    expect(exportFilename('Hero', 'svg', 3)).toBe('hero.svg');
  });

  it('cleans a suffix of path characters and keeps it short', () => {
    expect(cleanSuffix('@2x')).toBe('@2x');
    expect(cleanSuffix('/../dark mode.')).toBe('..dark-mode');
    expect(cleanSuffix('x'.repeat(40))).toHaveLength(24);
  });

  it('makes repeated names distinct, ignoring case', () => {
    expect(uniqueFilenames(['frame.png', 'Frame.png', 'frame.png', 'other.svg'])).toEqual([
      'frame.png',
      'Frame-2.png',
      'frame-3.png',
      'other.svg',
    ]);
  });
});
