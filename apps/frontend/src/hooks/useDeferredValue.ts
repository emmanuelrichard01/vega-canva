import { useEffect, useState } from 'react';

/**
 * A value that lags the one you give it, so expensive work downstream runs on
 * pauses rather than on keystrokes.
 *
 * ## Why not `useDeferredValue`
 *
 * React's own hook yields to *rendering* priority, which helps when the cost
 * is reconciliation. Here the cost is a parse plus a dagre layout in a
 * `useMemo` — synchronous work on the same tick, invisible to the scheduler,
 * which React will happily run at full typing rate. A short debounce is the
 * honest tool: it does not make the work cheaper, it makes it rarer.
 *
 * The delay is a judgement about typing, not about the work. Below about
 * 100ms a fast typist still pays for most keystrokes; much above 200ms the
 * preview stops feeling attached to the editor. 140 sits where a normal
 * inter-keystroke gap coalesces and a pause to think does not.
 */
export function useDebouncedValue<T>(value: T, delay = 140): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);

  return settled;
}
