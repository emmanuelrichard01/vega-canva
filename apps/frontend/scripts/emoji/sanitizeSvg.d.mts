export function sanitizeSvg(svg: string, idPrefix: string): { svg: string; warnings: string[] } | null;
export function compactPathData(d: string, decimals?: number): string | null;
export function codeFromSequence(native: string): string;
