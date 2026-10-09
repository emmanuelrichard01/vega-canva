/**
 * CRC-32 (IEEE 802.3, the polynomial ZIP and PNG both use).
 *
 * Table-driven and incremental: `crc32(chunk, crc32(previous))` continues a
 * running checksum, so a large file can be summed as it streams past without
 * being held whole.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The checksum of `bytes`, continuing from `previous` (the result of an earlier call). */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
