/** The colour a record label takes: the station's accent, or the average of an album cover. */
const STATION_TINTS: Record<string, string> = {
  ambient: '#5f7f74',
  piano: '#a58a67',
  lofi: '#d39a77',
  synth: '#e1488a',
  house: '#3fb5a3',
  retro: '#3a7bd5',
};

export const stationTint = (category: string): string | null => STATION_TINTS[category] ?? null;

/** Averages 8×8 pixels into a `#rrggbb`, ignoring near-black and near-white so the label keeps some colour. */
export function averageColour(data: ArrayLike<number>): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum < 24 || lum > 235) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (!n) return null;
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const cache = new Map<string, string | null>();

/** Samples a cover on a tiny canvas. Resolves null when the image will not load or is tainted. */
export function sampleTint(url: string): Promise<string | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      cache.set(url, v);
      resolve(v);
    };
    if (typeof document === 'undefined') return done(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 8;
        const ctx = c.getContext('2d');
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, 8, 8);
        done(averageColour(ctx.getImageData(0, 0, 8, 8).data));
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = url;
  });
}
