export interface IconPathRecord {
  d: string;
  f?: string;
  fo?: number;
  eo?: 1;
  s?: string;
  sw?: number;
  so?: number;
  lc?: string;
  lj?: string;
  m?: number[];
}
export function parseColour(v: string | null | undefined): string | null;
export function compactPath(d: string, decimals: number): string | null;
export function svgToIcon(svg: string): {
  viewBox: [number, number];
  paths: IconPathRecord[];
  warnings: string[];
} | null;
