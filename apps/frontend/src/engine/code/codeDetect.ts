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

/*
 * Every pattern here runs on every multi-line paste, on every keystroke in the
 * code editor and on collaborators' blocks, so each one has to be linear in
 * the length of the text.
 *
 * - Horizontal whitespace is spelled `[ \t]`. With the `m` flag a `\s` after
 *   `^` or before `$` crosses newlines, so a run of blank lines is retried
 *   from every one of them.
 * - No two adjacent quantifiers can match the same characters
 *   (`\s+.*\s+` took 20s on an `import` followed by spaces).
 * - Unbounded runs that could start at many positions (`[^>]*` after every
 *   `<p`) carry an upper bound.
 */
const SIGNALS: Record<string, Signal[]> = {
  typescript: [
    S(/\b(interface|type)[ \t]+[A-Z]\w*[ \t]*(<[^>\n]{0,200}>)?[ \t]*[={]/, 4),
    S(/:[ \t]*(string|number|boolean|void|unknown|any|never)\b/, 4),
    S(/\b(as const|satisfies|keyof|readonly)\b/, 3),
    S(/\b(public|private|protected)[ \t]+\w+[ \t]*[:(]/, 1),
    S(/\bimport\b[^\n]*?[ \t]from[ \t]*['"]/, 1),
    S(/\b(const|let)[ \t]+\w+[ \t]*=/, 1),
    S(/=>/, 1),
  ],
  javascript: [
    S(/\b(const|let|var)[ \t]+\w+[ \t]*=/, 2),
    S(/=>[ \t]*[{(]?/, 1),
    S(/\bfunction[ \t]*\w*[ \t]*\(/, 3),
    S(/\b(console\.log|document\.|window\.|require\(|module\.exports)/, 3),
    S(/\bimport\b[^\n]*?[ \t]from[ \t]*['"]/, 1),
    S(/\bexport[ \t]+(default|const|function)\b/, 1),
  ],
  python: [
    S(/^[ \t]*def[ \t]+\w+[ \t]*\([^\n]*\)[ \t]*(->[^\n:]{1,120})?:[ \t]*$/m, 5),
    S(/^[ \t]*(from[ \t]+[\w.]+[ \t]+)?import[ \t]+[\w.]+([ \t]+as[ \t]+\w+)?[ \t]*$/m, 2),
    S(/^[ \t]*class[ \t]+\w+(\([^\n]*\))?[ \t]*:[ \t]*$/m, 4),
    S(/\b(elif|self\.|None|True|False|print\()\b/, 2),
    S(/^[ \t]*(if|for|while|with|try|except)\b[^\n]*:[ \t]*$/m, 2),
    S(/^[ \t]*@\w+/m, 1),
  ],
  sql: [
    S(/\bselect\b[\s\S]+\bfrom\b/i, 5),
    S(/\b(insert[ \t]+into|update[ \t]+\w+[ \t]+set|delete[ \t]+from|create[ \t]+(table|index|view))\b/i, 5),
    S(/\b(where|join|group[ \t]+by|order[ \t]+by|limit)\b/i, 2),
  ],
  html: [
    S(/<!doctype html>/i, 6),
    S(/<(html|head|body|div|span|section|main|nav|ul|li|p|a|button|img|form|input|template)([ \t\n][^>]{0,500})?>/i, 3),
    S(/<\/\w+>/, 2),
  ],
  css: [
    S(/^[ \t.#:\w\-[\]="'>+~*,()]+\{[ \t]*$/m, 3),
    S(/^[ \t]*[\w-]+[ \t]*:[ \t]*[^;\n]+;[ \t]*$/m, 3),
    S(/@media|@import|@keyframes|:root|var\(--/, 3),
  ],
  json: [S(/^\s*[{[][\s\S]*[}\]]\s*$/, 1), S(/^[ \t]*"[\w-]+"[ \t]*:/m, 3)],
  bash: [
    S(/^#!\/(usr\/)?bin\/(env[ \t]+)?(ba|z)?sh/m, 8),
    S(/^[ \t]*\$[ \t]+\w+/m, 4),
    S(/^[ \t]*(sudo|apt(-get)?|brew|npm|npx|pnpm|yarn|git|docker|kubectl|curl|cd|export|echo|chmod|mkdir)[ \t]/m, 3),
    S(/\b(fi|done|esac)\b/, 3),
    S(/&&|\|[ \t]*grep\b/, 1),
  ],
  java: [
    S(/\bpublic[ \t]+(static[ \t]+)?(final[ \t]+)?(class|void|interface)\b/, 4),
    S(/System\.out\.println|import[ \t]+java\./, 6),
    S(/@Override/, 3),
  ],
  c: [S(/#include[ \t]*<\w+\.h>/, 6), S(/\bint[ \t]+main[ \t]*\(/, 3), S(/\bprintf[ \t]*\(/, 2), S(/\bmalloc[ \t]*\(/, 2)],
  cpp: [S(/#include[ \t]*<(iostream|vector|string|memory|map)>/, 7), S(/\bstd::/, 5), S(/\bcout[ \t]*<</, 4), S(/\btemplate[ \t]*</, 3)],
  csharp: [S(/\busing[ \t]+System(\.\w+)*;/, 6), S(/\bnamespace[ \t]+[\w.]+/, 2), S(/Console\.WriteLine/, 6), S(/\bpublic[ \t]+(async[ \t]+)?Task\b/, 4)],
  go: [S(/^package[ \t]+\w+/m, 6), S(/\bfunc[ \t]+(\(\w+[ \t]+\*?\w+\)[ \t]*)?\w+[ \t]*\(/, 4), S(/:=/, 2), S(/\bfmt\.\w+/, 4)],
  rust: [S(/\bfn[ \t]+\w+[ \t]*(<[^>\n]{0,200}>)?[ \t]*\(/, 4), S(/\blet[ \t]+mut\b/, 5), S(/\bimpl\b/, 3), S(/\w!\(/, 2), S(/->[ \t]*(Self|Result|Option|&?\w+)/, 1)],
  php: [S(/<\?php/, 8), S(/\$\w+[ \t]*=/, 3), S(/->\w+\(/, 1), S(/\becho[ \t]/, 1)],
  dart: [S(/\bvoid[ \t]+main[ \t]*\([ \t]*\)/, 3), S(/\bWidget[ \t]+build\(/, 6), S(/\b(final|late)[ \t]+\w+/, 2), S(/@override/, 3)],
  kotlin: [S(/\bfun[ \t]+\w+[ \t]*\(/, 5), S(/\bval[ \t]+\w+[ \t]*[:=]/, 3), S(/\bdata[ \t]+class\b/, 5)],
  swift: [S(/\bimport[ \t]+(SwiftUI|UIKit|Foundation)\b/, 7), S(/\bvar[ \t]+body:[ \t]*some[ \t]+View/, 7), S(/\bfunc[ \t]+\w+[ \t]*\(/, 2), S(/\bguard[ \t]+let\b/, 5)],
  ruby: [S(/^[ \t]*def[ \t]+\w+[?!]?(\([^\n]*\))?[ \t]*$/m, 4), S(/^[ \t]*end[ \t]*$/m, 3), S(/\b(puts|require_relative|attr_accessor)\b/, 4), S(/\bdo[ \t]*\|\w+\|/, 4)],
  yaml: [S(/^[ \t]*[\w-]+:[ \t]+\S/m, 2), S(/^[ \t]*-[ \t]+[\w-]+:[ \t]/m, 3), S(/^---[ \t]*$/m, 3), S(/^[ \t]*[\w-]+:[ \t]*$/m, 1)],
  markdown: [S(/^#{1,6}[ \t]+\S/m, 4), S(/^[ \t]*[-*][ \t]+\S/m, 1), S(/\[[^\]\n]{1,200}\]\([^)\n]{1,500}\)/, 3), S(/\*\*[^*\n]{1,200}\*\*/, 2), S(/^```/m, 3)],
  graphql: [S(/^[ \t]*(query|mutation|subscription|fragment)[ \t]+\w*[^{]{0,500}\{/m, 6), S(/^[ \t]*type[ \t]+\w+[ \t]*\{/m, 3), S(/\bon[ \t]+[A-Z]\w+[ \t]*\{/, 3)],
  dockerfile: [S(/^FROM[ \t]+[\w./:-]+/m, 7), S(/^(RUN|COPY|WORKDIR|ENTRYPOINT|CMD|EXPOSE)[ \t]/m, 4)],
  mermaid: [
    S(/^[ \t]*(graph|flowchart)[ \t]+(TD|TB|BT|RL|LR)\b/m, 9),
    S(/^[ \t]*(sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|journey|timeline)\b/m, 9),
    S(/-->|---|==>/, 1),
  ],
};

/** Detection signals that are a *different* language's evidence, subtracted. */
const PENALTIES: Record<string, Signal[]> = {
  javascript: [S(/:[ \t]*(string|number|boolean)\b|\binterface[ \t]+[A-Z]/, 4)],
  css: [S(/\b(function|const|return|def|class)\b/, 4)],
  yaml: [S(/[;{}][ \t]*$/m, 4), S(/^[ \t]*(def|class|function|import)\b/m, 4)],
  json: [S(/^[ \t]*\w+[ \t]*:/m, 2)],
  c: [S(/\bstd::|#include[ \t]*<(iostream|vector|string)>/, 6)],
  markdown: [S(/[;{}][ \t]*$/m, 3)],
};

/**
 * How much of a snippet detection reads. The marks that identify a language
 * sit in its first lines; reading further only adds time on a paste that is
 * mostly data.
 */
export const DETECT_LIMIT = 4000;

export interface Detection {
  language: string;
  /** 0..1, how far ahead of the runner-up the winner is. */
  confidence: number;
  score: number;
}

export function detectLanguage(source: string): Detection {
  const text = source.slice(0, DETECT_LIMIT);
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
