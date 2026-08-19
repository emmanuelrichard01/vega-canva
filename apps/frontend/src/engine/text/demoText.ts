/**
 * Placeholder copy for a text block.
 *
 * ## Why not lorem ipsum
 *
 * Lorem ipsum is designed to be *unreadable*, so the eye slides off it and
 * judges the shape of the paragraph alone. That is exactly right for a print
 * specimen and wrong here, because a text block on this canvas is a stand-in
 * for something a person will actually write — a caption, a note, a paragraph
 * in a wireframe — and the questions it has to answer are "does my type size
 * work", "is this line length comfortable", "does this box hold what I meant".
 * None of those can be answered against text nobody can read.
 *
 * It is also a small thing that makes a mock look finished. A wireframe filled
 * with Latin reads as unfinished to anyone you show it to; one filled with
 * plausible English reads as a draft of the real thing.
 *
 * ## Why one passage rather than a generator
 *
 * The lengths are prefixes of a single continuous passage, so every size is a
 * grammatical sentence that ends where a sentence ends. A generator stitching
 * random sentences hits the count exactly and reads as nonsense; picking a
 * whole passage per length means five separate texts to keep in tone. One
 * passage cut at sentence boundaries gives both — the 20-word version is the
 * opening of the 100-word one, which is also what makes swapping between
 * lengths feel like the same block growing rather than being replaced.
 */

/**
 * The passage, split at the points a prefix may end.
 *
 * Each entry is a full sentence. The cut points below are chosen so that the
 * running word count lands near the offered sizes *and* on a sentence end —
 * approximate on the number, exact on the grammar, which is the right way
 * round: nobody counts the words, and everybody notices a sentence that stops
 * halfway.
 */
const SENTENCES = [
  'The survey team reached the ridge just before the light went.',
  'Below them the valley held its river like a thread pulled tight.',
  'Nobody had mapped this side of it in forty years, and the old charts disagreed with each other about almost everything.',
  'They set the instruments down and waited for the wind to drop.',
  'What they were measuring would not settle until the air did.',
  'By morning the readings had steadied enough to be worth writing down, and the argument about which chart had been right could finally begin.',
];

/** The word counts the tool offers. */
export const DEMO_LENGTHS = [20, 30, 40, 50, 100] as const;
export type DemoLength = (typeof DEMO_LENGTHS)[number];

const wordsIn = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The passage cut to roughly `words`, always ending on a full sentence.
 *
 * Takes sentences until adding the next would overshoot the target by more
 * than it undershoots — so the result is the closest sentence boundary rather
 * than the last one that fits, which for a long final sentence would land the
 * 100-word block nearer 70.
 *
 * The passage repeats if a caller asks for more than it holds, rather than
 * returning short. A block that silently ignored the size it was given is the
 * kind of thing nobody notices until a layout is wrong.
 */
export function demoText(words: number): string {
  const chosen: string[] = [];
  let count = 0;
  let index = 0;

  while (count < words) {
    const next = SENTENCES[index % SENTENCES.length];
    const after = count + wordsIn(next);
    // Stop before a sentence that would take us further past the target than
    // stopping here leaves us short of it.
    if (chosen.length > 0 && after - words > words - count) break;
    chosen.push(next);
    count = after;
    index += 1;
    // One full pass is the most any offered size needs; the guard is for a
    // caller asking for something absurd rather than for the sizes above.
    if (index > SENTENCES.length * 4) break;
  }

  return chosen.join(' ');
}

/**
 * A sensible box for a block of that many words.
 *
 * Held to roughly 46–62 characters a line, which is the measure DESIGN.md sets
 * for prose and the range typography has agreed on for a century. A 100-word
 * block dropped at an arbitrary width is either a single unreadable line or a
 * narrow column, and the point of the tool is that it lands looking right.
 */
export function demoBox(words: number): { width: number; height: number } {
  const width = words <= 30 ? 320 : words <= 50 ? 380 : 440;
  // ~5.6 characters per word including its space, at ~7.2px a character.
  const charsPerLine = width / 7.2;
  const lines = Math.max(1, Math.ceil((words * 5.6) / charsPerLine));
  return { width, height: Math.max(60, Math.round(lines * 24 + 16)) };
}
