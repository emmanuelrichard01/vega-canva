/**
 * Placeholder text: the words a slide layout writes where content goes.
 *
 * Kept apart from the layouts themselves so the presenter, the slide pictures
 * and the placeholder behaviour can recognise a placeholder without loading
 * the layout builders.
 *
 * A text node holding exactly one of these is a placeholder; holding anything
 * else, it is content.
 */
export const PROMPTS = {
  title: 'Click to add title',
  subtitle: 'Click to add subtitle',
  heading: 'Click to add heading',
  body: 'Click to add text',
  footer: 'Click to add speaker and date',
  number: 'Number',
  label: 'Click to add what it measures',
  quote: 'Click to add a quote',
  attribution: 'Click to add who said it',
  image: 'Drop an image here',
  takeaway: 'Click to add the takeaway',
} as const;

const PROMPT_SET = new Set<string>(Object.values(PROMPTS));

/** How a placeholder looks while it waits: the real type, quietened. */
export const PLACEHOLDER_OPACITY = 0.6;

/** Whether a node is an unfilled placeholder. */
export function isPlaceholder(node: { type: string; text?: unknown } | null | undefined): boolean {
  return !!node && node.type === 'text' && typeof node.text === 'string' && PROMPT_SET.has(node.text);
}
