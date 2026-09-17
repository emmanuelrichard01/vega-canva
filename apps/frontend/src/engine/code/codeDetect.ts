import { languageForAlias } from './codeLanguages';

/**
 * Which language a snippet is, from what it looks like.
 *
 * ## Why signals and not a model
 *
 * The snippets people paste onto a board are short — a function, a query, a
 * config block — and short is exactly where statistical detectors are least
 * reliable: ten lines of JavaScript and ten lines of TypeScript differ by one
 * type annotation. What does separate them is a handful of unmistakable marks
 * (`def …:`, `SELECT … FROM`, `package main`, `#include <`), so each language
 * is a list of weighted marks and the snippet is scored against all of them.
 *
 * The detector is allowed to be unsure. Below a clear winner it says
 * `plaintext` rather than guessing, because a wrong language colours a snippet
 * confidently and misleadingly, and a plain one merely colours it not at all.
 */

interface Signal {
  re: RegExp;
  weight: number;
}

const S = (re: RegExp, weight: number): Signal => ({ re, weight });

const SIGNALS: Record<string, Signal[]> = {
  typescript: [
    S(/\b(interface|type)\s+[A-Z]\w*\s*(<[^>]*>)?\s*[={]/, 4),
    S(/:\s*(string|number|boolean|void|unknown|any|never)\b/, 4),
    S(/\b(as const|satisfies|keyof|readonly)\b/, 3),
    S(/\b(public|private|protected)\s+\w+\s*[:(]/, 1),
    S(/import\s+.*\s+from\s+['"]/, 1),
    S(/\b(const|let)\s+\w+\s*=/, 1),
    S(/=>/, 1),
  ],
  javascript: [
    S(/\b(const|let|var)\s+\w+\s*=/, 2),
    S(/=>\s*[{(]?/, 1),
    S(/\bfunction\s*\w*\s*\(/, 3),
    S(/\b(console\.log|document\.|window\.|require\(|module\.exports)/, 3),
    S(/import\s+.*\s+from\s+['"]/, 1),
    S(/\bexport\s+(default|const|function)\b/, 1),
  ],
  python: [
    S(/^\s*def\s+\w+\s*\(.*\)\s*(->\s*[\w[\], .]+)?\s*:\s*$/m, 5),
    S(/^\s*(from\s+[\w.]+\s+)?import\s+[\w.]+(\s+as\s+\w+)?\s*$/m, 2),
    S(/^\s*class\s+\w+(\(.*\))?\s*:\s*$/m, 4),
    S(/\b(elif|self\.|None|True|False|print\()\b/, 2),
    S(/^\s*(if|for|while|with|try|except)\b.*:\s*$/m, 2),
    S(/^\s*@\w+/m, 1),
  ],
  sql: [
    S(/\bselect\b[\s\S]+\bfrom\b/i, 5),
    S(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(table|index|view))\b/i, 5),
    S(/\b(where|join|group\s+by|order\s+by|limit)\b/i, 2),
  ],
  html: [
    S(/<!doctype html>/i, 6),
    S(/<(html|head|body|div|span|section|main|nav|ul|li|p|a|button|img|form|input|template)(\s[^>]*)?>/i, 3),
    S(/<\/\w+>/, 2),
  ],
  css: [
    S(/^[\s.#:\w-[\]="'>+~*,()]+\{\s*$/m, 3),
    S(/^\s*[\w-]+\s*:\s*[^;]+;\s*$/m, 3),
    S(/@media|@import|@keyframes|:root|var\(--/, 3),
  ],
  json: [S(/^\s*[{[][\s\S]*[}\]]\s*$/, 1), S(/^\s*"[\w-]+"\s*:/m, 3)],
  bash: [
    S(/^#!\/(usr\/)?bin\/(env\s+)?(ba|z)?sh/m, 8),
    S(/^\s*\$\s+\w+/m, 4),
    S(/^\s*(sudo|apt(-get)?|brew|npm|npx|pnpm|yarn|git|docker|kubectl|curl|cd|export|echo|chmod|mkdir)\s/m, 3),
    S(/\b(fi|done|esac)\b/, 3),
    S(/&&|\|\s*grep\b/, 1),
  ],
  java: [
    S(/\bpublic\s+(static\s+)?(final\s+)?(class|void|interface)\b/, 4),
    S(/System\.out\.println|import\s+java\./, 6),
    S(/@Override/, 3),
  ],
  c: [S(/#include\s*<\w+\.h>/, 6), S(/\bint\s+main\s*\(/, 3), S(/\bprintf\s*\(/, 2), S(/\bmalloc\s*\(/, 2)],
  cpp: [S(/#include\s*<(iostream|vector|string|memory|map)>/, 7), S(/\bstd::/, 5), S(/\bcout\s*<</, 4), S(/\btemplate\s*</, 3)],
  csharp: [S(/\busing\s+System(\.\w+)*;/, 6), S(/\bnamespace\s+[\w.]+/, 2), S(/Console\.WriteLine/, 6), S(/\bpublic\s+(async\s+)?Task\b/, 4)],
  go: [S(/^package\s+\w+/m, 6), S(/\bfunc\s+(\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/, 4), S(/:=/, 2), S(/\bfmt\.\w+/, 4)],
  rust: [S(/\bfn\s+\w+\s*(<[^>]*>)?\s*\(/, 4), S(/\blet\s+mut\b/, 5), S(/\bimpl\b/, 3), S(/\w+!\(/, 2), S(/->\s*(Self|Result|Option|&?\w+)/, 1)],
  php: [S(/<\?php/, 8), S(/\$\w+\s*=/, 3), S(/->\w+\(/, 1), S(/\becho\s/, 1)],
  dart: [S(/\bvoid\s+main\s*\(\s*\)/, 3), S(/\bWidget\s+build\(/, 6), S(/\b(final|late)\s+\w+/, 2), S(/@override/, 3)],
  kotlin: [S(/\bfun\s+\w+\s*\(/, 5), S(/\bval\s+\w+\s*[:=]/, 3), S(/\bdata\s+class\b/, 5)],
  swift: [S(/\bimport\s+(SwiftUI|UIKit|Foundation)\b/, 7), S(/\bvar\s+body:\s*some\s+View/, 7), S(/\bfunc\s+\w+\s*\(/, 2), S(/\bguard\s+let\b/, 5)],
  ruby: [S(/^\s*def\s+\w+[?!]?(\(.*\))?\s*$/m, 4), S(/^\s*end\s*$/m, 3), S(/\b(puts|require_relative|attr_accessor)\b/, 4), S(/\bdo\s*\|\w+\|/, 4)],
  yaml: [S(/^\s*[\w-]+:\s+\S/m, 2), S(/^\s*-\s+[\w-]+:\s/m, 3), S(/^---\s*$/m, 3), S(/^\s*[\w-]+:\s*$/m, 1)],
  markdown: [S(/^#{1,6}\s+\S/m, 4), S(/^\s*[-*]\s+\S/m, 1), S(/\[[^\]]+\]\([^)]+\)/, 3), S(/\*\*[^*]+\*\*/, 2), S(/^```/m, 3)],
  graphql: [S(/^\s*(query|mutation|subscription|fragment)\s+\w*[\s\S]*\{/m, 6), S(/^\s*type\s+\w+\s*\{/m, 3), S(/\bon\s+[A-Z]\w+\s*\{/, 3)],
  dockerfile: [S(/^FROM\s+[\w./:-]+/m, 7), S(/^(RUN|COPY|WORKDIR|ENTRYPOINT|CMD|EXPOSE)\s/m, 4)],
  mermaid: [
    S(/^\s*(graph|flowchart)\s+(TD|TB|BT|RL|LR)\b/m, 9),
    S(/^\s*(sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|journey|timeline)\b/m, 9),
    S(/-->|---|==>/, 1),
  ],
};

/** Detection signals that are a *different* language's evidence, subtracted. */
const PENALTIES: Record<string, Signal[]> = {
  javascript: [S(/:\s*(string|number|boolean)\b|\binterface\s+[A-Z]/, 4)],
  css: [S(/\b(function|const|return|def|class)\b/, 4)],
  yaml: [S(/[;{}]\s*$/m, 4), S(/^\s*(def|class|function|import)\b/m, 4)],
  json: [S(/^\s*\w+\s*:/m, 2)],
  c: [S(/\bstd::|#include\s*<(iostream|vector|string)>/, 6)],
  markdown: [S(/[;{}]\s*$/m, 3)],
};

export interface Detection {
  language: string;
  /** 0..1, how far ahead of the runner-up the winner is. */
  confidence: number;
  score: number;
}

export function detectLanguage(source: string): Detection {
  const text = source.slice(0, 8000);
  if (!text.trim()) return { language: 'plaintext', confidence: 0, score: 0 };

  const scores: Array<[string, number]> = Object.entries(SIGNALS).map(([id, signals]) => {
    let score = 0;
    for (const s of signals) if (s.re.test(text)) score += s.weight;
    for (const p of PENALTIES[id] ?? []) if (p.re.test(text)) score -= p.weight;
    return [id, score];
  });

  // JSON has a proof rather than a guess.
  try {
    const t = text.trim();
    if ((t.startsWith('{') || t.startsWith('[')) && t.length > 1) {
      JSON.parse(t);
      scores.push(['json', 20]);
    }
  } catch {
    /* not JSON */
  }

  scores.sort((a, b) => b[1] - a[1]);
  const [best, runner] = scores;
  if (!best || best[1] < 3) return { language: 'plaintext', confidence: 0, score: best?.[1] ?? 0 };
  const lead = best[1] - (runner?.[1] ?? 0);
  return { language: best[0], confidence: Math.min(1, lead / Math.max(3, best[1])), score: best[1] };
}

export interface Fence {
  language: string | null;
  source: string;
  filename?: string;
}

/**
 * A Markdown fence, the way code travels through chat, docs and AI answers.
 *
 * ```` ```ts title="api.ts" ```` is understood: the tag names the language and
 * a `title` or a bare filename names the file. Returns `null` unless the whole
 * text is one fence, so a document that merely contains one is still text.
 */
export function parseFence(text: string): Fence | null {
  const m = text.trim().match(/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n?\1\s*$/);
  if (!m) return null;
  const info = m[2].trim();
  const [tag, ...rest] = info.split(/\s+/);
  const title = info.match(/title=["']?([^"'\s]+)/)?.[1] ?? rest.find((r) => /\.\w+$/.test(r));
  return {
    language: tag ? languageForAlias(tag) : null,
    source: m[3],
    filename: title,
  };
}

/**
 * Whether pasted text is code rather than prose.
 *
 * Deliberately strict. Turning a pasted paragraph into a code block is a worse
 * mistake than leaving a snippet as text — the paragraph loses its wrapping and
 * its font, and the person has to notice and undo it — so it takes several
 * lines, a confident detection, and the texture code has: indentation,
 * brackets, operators, few sentences.
 */
export function looksLikeCode(text: string): Detection | null {
  const trimmed = text.trim();
  const lines = trimmed.split('\n');
  if (lines.length < 2) return null;
  const detection = detectLanguage(trimmed);
  if (detection.language === 'plaintext' || detection.language === 'markdown') return null;
  const symbols = (trimmed.match(/[{}()[\];=<>:$#]/g) ?? []).length / trimmed.length;
  const indented = lines.filter((l) => /^(\s{2,}|\t)\S/.test(l)).length / lines.length;
  const sentences = (trimmed.match(/[a-z]{3,}[,.] [A-Z]/g) ?? []).length;
  const texture = symbols > 0.03 || indented > 0.25;
  if (!texture || sentences > lines.length / 2) return null;
  return detection.score >= 5 || (detection.score >= 3 && detection.confidence > 0.4) ? detection : null;
}
