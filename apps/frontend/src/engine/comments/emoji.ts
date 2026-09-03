/**
 * Emoji for comments: the set, the search, and the `:shortcode` trigger.
 *
 * ## Why a curated set rather than the Unicode tables
 *
 * The full emoji set is about 3,800 characters, and shipping it means a
 * megabyte of names and keywords, a virtualised grid to draw it, and a search
 * that has to be good enough to make 3,800 findable. That is a keyboard, and
 * this is a comment box on a design tool.
 *
 * The set here is the couple of hundred that people actually reach for in
 * review comments — approval, objection, attention, progress, and the small
 * vocabulary of feelings that keeps a written critique from reading as curt.
 * It fits in memory, renders without virtualisation, and every entry is one
 * somebody has a reason to want.
 *
 * ## Why `:` shares the mention machinery
 *
 * `MentionInput` already resolves a trigger character into `{ from, to, query }`
 * and hands the result to a picker. A second trigger that returns the same
 * shape is a few lines and one more branch; a second trigger that grows its own
 * caret tracking, its own dismissal rule and its own keyboard handling is a
 * parallel implementation of a solved problem, and the two will disagree the
 * first time either is touched.
 *
 * ## The `:` trigger is the part that needs care
 *
 * `@` is rare in prose. `:` is not — `Note:`, `10:30`, `https://`, `TODO:` are
 * all ordinary things to type in a comment, and a picker that opens on each of
 * them is worse than no picker. So the trigger requires **whitespace or
 * start-of-line before the colon** (which excludes `https:` and `10:30`, whose
 * colons follow a letter and a digit) and **at least two word characters
 * after** it (which excludes a bare `Note:` until you keep typing). Those two
 * rules between them leave almost nothing that fires by accident.
 */

export type EmojiCategory = 'reaction' | 'people' | 'nature' | 'object' | 'symbol';

export interface EmojiEntry {
  char: string;
  /** The `:shortcode:` name. Lower case, no spaces — this is what gets typed. */
  name: string;
  /** Other words that should find it. The name itself is always searched. */
  keywords: string[];
  category: EmojiCategory;
  /**
   * Takes a skin-tone modifier.
   *
   * Only some emoji do, and appending one to an emoji that does not — a
   * rocket, a fire — produces a character pair no font has, which renders as
   * the emoji followed by a coloured square. So this is a fact about each
   * entry rather than a rule applied to a category.
   */
  tone?: true;
}

export const EMOJI_CATEGORIES: { id: EmojiCategory; label: string }[] = [
  { id: 'reaction', label: 'Reactions' },
  { id: 'people', label: 'People' },
  { id: 'nature', label: 'Nature' },
  { id: 'object', label: 'Objects' },
  { id: 'symbol', label: 'Symbols' },
];

const e = (
  char: string,
  name: string,
  keywords: string[],
  category: EmojiCategory,
  tone?: true,
): EmojiEntry => ({ char, name, keywords, category, tone });

export const EMOJI: EmojiEntry[] = [
  // ---- Reactions: the ones a review actually uses -------------------------
  e('👍', 'thumbsup', ['yes', 'approve', 'ok', 'lgtm', 'agree', 'good'], 'reaction', true),
  e('👎', 'thumbsdown', ['no', 'disagree', 'reject', 'bad'], 'reaction', true),
  e('✅', 'white_check_mark', ['done', 'check', 'tick', 'complete', 'fixed'], 'reaction'),
  e('❌', 'x', ['no', 'wrong', 'cross', 'fail', 'remove'], 'reaction'),
  e('❤️', 'heart', ['love', 'like', 'red'], 'reaction'),
  e('🔥', 'fire', ['hot', 'lit', 'great', 'burn'], 'reaction'),
  e('🎉', 'tada', ['party', 'celebrate', 'ship', 'launch', 'yay'], 'reaction'),
  e('👏', 'clap', ['applause', 'bravo', 'well done'], 'reaction', true),
  e('🙌', 'raised_hands', ['praise', 'celebrate', 'yay'], 'reaction', true),
  e('🚀', 'rocket', ['ship', 'launch', 'fast', 'deploy'], 'reaction'),
  e('👀', 'eyes', ['look', 'watching', 'review', 'see'], 'reaction'),
  e('💯', '100', ['perfect', 'score', 'agree', 'exactly'], 'reaction'),
  e('⚡', 'zap', ['fast', 'quick', 'energy', 'performance'], 'reaction'),
  e('✨', 'sparkles', ['new', 'shiny', 'polish', 'magic'], 'reaction'),
  e('🙏', 'pray', ['thanks', 'please', 'grateful'], 'reaction', true),
  e('🤝', 'handshake', ['deal', 'agree', 'partner'], 'reaction'),

  // ---- People and faces ---------------------------------------------------
  e('😀', 'grinning', ['happy', 'smile'], 'people'),
  e('😄', 'smile', ['happy', 'joy', 'grin'], 'people'),
  e('😅', 'sweat_smile', ['nervous', 'phew', 'relief'], 'people'),
  e('😂', 'joy', ['laugh', 'lol', 'funny', 'tears'], 'people'),
  e('🙂', 'slightly_smiling_face', ['smile', 'fine', 'ok'], 'people'),
  e('😉', 'wink', ['joke', 'flirt'], 'people'),
  e('😊', 'blush', ['happy', 'warm', 'shy'], 'people'),
  e('😍', 'heart_eyes', ['love', 'want', 'beautiful'], 'people'),
  e('🤩', 'star_struck', ['amazed', 'wow', 'excited'], 'people'),
  e('🤔', 'thinking_face', ['hmm', 'consider', 'unsure', 'question'], 'people'),
  e('🤨', 'raised_eyebrow', ['skeptical', 'doubt', 'really'], 'people'),
  e('😐', 'neutral_face', ['meh', 'blank', 'flat'], 'people'),
  e('😬', 'grimacing', ['awkward', 'yikes', 'eek'], 'people'),
  e('😴', 'sleeping', ['tired', 'zzz', 'bored'], 'people'),
  e('😭', 'sob', ['cry', 'sad', 'upset'], 'people'),
  e('😱', 'scream', ['shock', 'fear', 'omg'], 'people'),
  e('🤯', 'exploding_head', ['mind blown', 'wow', 'shock'], 'people'),
  e('😎', 'sunglasses', ['cool', 'confident'], 'people'),
  e('🥳', 'partying_face', ['celebrate', 'party', 'birthday'], 'people'),
  e('🫠', 'melting_face', ['overwhelmed', 'hot', 'stress'], 'people'),
  e('🤷', 'shrug', ['dunno', 'whatever', 'unsure'], 'people', true),
  e('🙋', 'raising_hand', ['volunteer', 'me', 'question'], 'people', true),
  e('👋', 'wave', ['hello', 'hi', 'bye'], 'people', true),
  e('👌', 'ok_hand', ['fine', 'good', 'perfect'], 'people', true),
  e('🤞', 'crossed_fingers', ['hope', 'luck'], 'people', true),
  e('💪', 'muscle', ['strong', 'effort', 'power'], 'people', true),
  e('🧠', 'brain', ['smart', 'think', 'idea'], 'people'),
  e('👇', 'point_down', ['below', 'here'], 'people', true),
  e('👉', 'point_right', ['this', 'see'], 'people', true),
  e('☝️', 'point_up', ['above', 'note', 'one'], 'people', true),

  // ---- Nature -------------------------------------------------------------
  e('🌟', 'star2', ['favourite', 'highlight', 'shine'], 'nature'),
  e('🌈', 'rainbow', ['colour', 'pride', 'gradient'], 'nature'),
  e('🌱', 'seedling', ['new', 'growth', 'start'], 'nature'),
  e('🌊', 'ocean', ['wave', 'water', 'flow'], 'nature'),
  e('🐛', 'bug', ['defect', 'issue', 'problem'], 'nature'),
  e('🦄', 'unicorn', ['rare', 'special', 'magic'], 'nature'),
  e('🐢', 'turtle', ['slow', 'lag', 'performance'], 'nature'),
  e('☀️', 'sunny', ['light', 'day', 'bright'], 'nature'),
  e('🌙', 'crescent_moon', ['dark', 'night', 'theme'], 'nature'),
  e('❄️', 'snowflake', ['cold', 'freeze', 'frozen'], 'nature'),

  // ---- Objects ------------------------------------------------------------
  e('🎨', 'art', ['design', 'palette', 'colour', 'paint'], 'object'),
  e('🖌️', 'paintbrush', ['draw', 'brush', 'design'], 'object'),
  e('📐', 'triangular_ruler', ['measure', 'align', 'geometry', 'spec'], 'object'),
  e('📏', 'straight_ruler', ['measure', 'size', 'spacing'], 'object'),
  e('✏️', 'pencil2', ['edit', 'write', 'change'], 'object'),
  e('📝', 'memo', ['note', 'write', 'doc'], 'object'),
  e('📌', 'pushpin', ['pin', 'important', 'keep'], 'object'),
  e('🔍', 'mag', ['search', 'find', 'zoom', 'inspect'], 'object'),
  e('🔗', 'link', ['url', 'connect', 'reference'], 'object'),
  e('📎', 'paperclip', ['attach', 'file'], 'object'),
  e('🗑️', 'wastebasket', ['delete', 'remove', 'trash'], 'object'),
  e('🔒', 'lock', ['locked', 'secure', 'private'], 'object'),
  e('🔓', 'unlock', ['open', 'public'], 'object'),
  e('💡', 'bulb', ['idea', 'suggestion', 'tip'], 'object'),
  e('🔧', 'wrench', ['fix', 'tool', 'repair'], 'object'),
  e('🔨', 'hammer', ['build', 'make', 'fix'], 'object'),
  e('⚙️', 'gear', ['settings', 'config', 'system'], 'object'),
  e('🧪', 'test_tube', ['test', 'experiment', 'try'], 'object'),
  e('📦', 'package', ['ship', 'release', 'bundle'], 'object'),
  e('🖼️', 'framed_picture', ['image', 'frame', 'art', 'asset'], 'object'),
  e('📊', 'bar_chart', ['data', 'metrics', 'stats'], 'object'),
  e('📈', 'chart_increasing', ['up', 'growth', 'better'], 'object'),
  e('📉', 'chart_decreasing', ['down', 'worse', 'drop'], 'object'),
  e('⏰', 'alarm_clock', ['time', 'deadline', 'late'], 'object'),
  e('☕', 'coffee', ['break', 'morning', 'tired'], 'object'),
  e('🎯', 'dart', ['target', 'goal', 'exact', 'precise'], 'object'),
  e('🧩', 'jigsaw', ['piece', 'part', 'fit', 'component'], 'object'),
  e('🪄', 'magic_wand', ['auto', 'magic', 'generate'], 'object'),

  // ---- Symbols ------------------------------------------------------------
  e('⚠️', 'warning', ['caution', 'careful', 'risk'], 'symbol'),
  e('🚨', 'rotating_light', ['urgent', 'alert', 'critical'], 'symbol'),
  e('❓', 'question', ['ask', 'unsure', 'why'], 'symbol'),
  e('❗', 'exclamation', ['important', 'attention'], 'symbol'),
  e('➕', 'heavy_plus_sign', ['add', 'more', 'plus'], 'symbol'),
  e('➖', 'heavy_minus_sign', ['remove', 'less', 'minus'], 'symbol'),
  e('🔁', 'repeat', ['loop', 'again', 'retry'], 'symbol'),
  e('⏳', 'hourglass_flowing_sand', ['wait', 'pending', 'slow'], 'symbol'),
  e('🆕', 'new', ['fresh', 'added'], 'symbol'),
  e('🔝', 'top', ['best', 'first', 'up'], 'symbol'),
  e('💬', 'speech_balloon', ['comment', 'talk', 'discuss'], 'symbol'),
  e('🏁', 'checkered_flag', ['finish', 'done', 'end'], 'symbol'),
];

const BY_NAME = new Map(EMOJI.map((x) => [x.name, x]));

export function emojiByName(name: string): EmojiEntry | undefined {
  return BY_NAME.get(name.toLowerCase());
}

// ---------------------------------------------------------------------------
// Skin tone
// ---------------------------------------------------------------------------

/**
 * The five Fitzpatrick modifiers, and "no modifier" as a real option.
 *
 * Stored as one preference rather than offered per insertion: nobody picks a
 * different skin tone per message, and asking every time turns a one-keystroke
 * insertion into a two-step one. It is the arrangement Slack and GitHub both
 * settled on for the same reason.
 */
export const SKIN_TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

const TONE_KEY = 'vega_emoji_tone';

export function readSkinTone(): SkinTone {
  try {
    const raw = localStorage.getItem(TONE_KEY) ?? '';
    return (SKIN_TONES as readonly string[]).includes(raw) ? (raw as SkinTone) : '';
  } catch {
    return '';
  }
}

export function writeSkinTone(tone: SkinTone): void {
  try {
    localStorage.setItem(TONE_KEY, tone);
  } catch {
    /* a blocked store is not worth a message about an emoji preference */
  }
}

/**
 * The character to insert, with the tone applied where it belongs.
 *
 * Guarded on `entry.tone` rather than applied to everything: appending a
 * modifier to an emoji that does not take one produces a pair no font has, and
 * it renders as the emoji followed by a coloured square. The failure is
 * per-character, so the fact has to be per-character too.
 *
 * ## The variation selector has to go
 *
 * Some emoji are written as a base plus U+FE0F, the selector that asks for the
 * colour presentation rather than the monochrome glyph — `☝️` is one. A skin
 * tone modifier must follow the **base** immediately, so appending it to the
 * full sequence produces base + VS16 + modifier, which is not a valid emoji
 * sequence: it draws as a monochrome-or-colour hand followed by a coloured
 * square, depending on the font.
 *
 * The modifier also implies the colour presentation on its own, so dropping
 * VS16 loses nothing. This is the kind of thing a test found and reading would
 * not have: every affected character still *rendered*, just as two glyphs
 * instead of one.
 *
 * Anything built from several real codepoints — a family, a couple, anything
 * joined with a zero-width joiner — needs more than an append, so nothing in
 * the set above is marked `tone` unless its base is a single codepoint.
 */
export function withTone(entry: EmojiEntry, tone: SkinTone): string {
  if (!entry.tone || !tone) return entry.char;
  return `${entry.char.replace(/️$/, '')}${tone}`;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Entries matching a query, best first.
 *
 * Four tiers, and the order is the whole design: an exact shortcode beats a
 * prefix, a prefix beats a keyword, and a keyword beats a substring buried in
 * the middle of a name. Without the tiers, typing `he` puts `exploding_head`
 * above `heart`, and the first result is what Enter takes.
 */
export function searchEmoji(query: string, limit = 24): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return EMOJI.slice(0, limit);

  const scored: { entry: EmojiEntry; score: number }[] = [];
  for (const entry of EMOJI) {
    let score: number | null = null;
    if (entry.name === q) score = 0;
    else if (entry.name.startsWith(q)) score = 1;
    else if (entry.keywords.some((k) => k === q || k.startsWith(q))) score = 2;
    else if (entry.name.includes(q) || entry.keywords.some((k) => k.includes(q))) score = 3;
    if (score !== null) scored.push({ entry, score });
  }

  // Stable within a tier, so the catalogue's own order — reactions first —
  // decides ties. `sort` is stable in every engine this runs on.
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

// ---------------------------------------------------------------------------
// The `:` trigger
// ---------------------------------------------------------------------------

/**
 * The `:shortcode` being typed at the caret, if there is one.
 *
 * Mirrors `activeMentionQuery`'s contract exactly — same return shape, same
 * job — so `MentionInput` can hold two triggers without holding two
 * mechanisms.
 *
 * Two rules keep it out of ordinary prose, and both are load-bearing:
 *
 * - **The colon must follow whitespace or start a line.** `https://` and
 *   `10:30` both have a colon after a non-space character, so neither fires.
 * - **At least two word characters must follow it.** `Note:` and `TODO:` stay
 *   quiet until you keep typing, and a lone `:` never opens anything.
 *
 * A space ends the query, so `: not a shortcode` is prose.
 */
export function activeEmojiQuery(
  text: string,
  caret: number,
): { query: string; from: number; to: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf(':');
  if (at === -1) return null;

  const preceding = at === 0 ? '' : before[at - 1];
  if (preceding && !/\s/.test(preceding)) return null;

  const query = before.slice(at + 1);
  if (query.length < 2) return null;
  // Letters, digits, `_`, `+`, `-`: everything a shortcode is made of. Anything
  // else — a space, a slash, punctuation — means this colon was prose.
  if (!/^[a-z0-9_+-]+$/i.test(query)) return null;

  return { query, from: at, to: caret };
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

const RECENT_KEY = 'vega_recent_emoji';
const RECENT_MAX = 16;

export function readRecentEmoji(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Most recent first, no duplicates. Returns the new list. */
export function pushRecentEmoji(char: string): string[] {
  const next = [char, ...readRecentEmoji().filter((c) => c !== char)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* same */
  }
  return next;
}
