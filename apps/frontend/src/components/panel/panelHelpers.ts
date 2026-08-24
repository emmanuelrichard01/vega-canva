export function shortFont(stack: string): string {
  return (stack.split(',')[0] ?? stack).replace(/["']/g, '').trim();
}
