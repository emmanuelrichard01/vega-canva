import type { IconCatalogue } from './iconTypes';

export interface IconHit {
  iconId: string;
  name: string;
  category: string;
  score: number;
}

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9.+]+/).filter(Boolean);

/**
 * Rank catalogue rows against a query. Every query word must match somewhere in
 * the name, keywords or category; a word that starts a name word scores above
 * one found mid-word, and a name that starts with the whole query tops both.
 * Ties keep catalogue order (stable sort), which is the vendor's own grouping.
 */
export function searchCatalogue(cat: IconCatalogue, query: string, limit = 400): IconHit[] {
  const words = tokens(query);
  if (!words.length) return [];
  const catName = new Map(cat.cats);
  const q = query.trim().toLowerCase();
  const hits: IconHit[] = [];
  for (const [iconId, name, keywords] of cat.icons) {
    const category = catName.get(iconId.slice(0, iconId.indexOf('/'))) ?? '';
    const nameL = name.toLowerCase();
    const nameWords = tokens(name);
    const rest = `${keywords} ${category}`.toLowerCase();
    let score = 0;
    let ok = true;
    for (const w of words) {
      if (nameWords.some((n) => n.startsWith(w))) score += 4;
      else if (nameL.includes(w)) score += 2;
      else if (rest.includes(w)) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (nameL.startsWith(q)) score += 6;
    hits.push({ iconId, name, category, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
