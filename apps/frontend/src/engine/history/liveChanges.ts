import type * as Y from 'yjs';

/**
 * Count the edits other people make to the live board while you look at the
 * past, so the banner can say "3 new changes since you started viewing".
 *
 * One per remote transaction that touched the watched maps, which matches
 * what "a change" means everywhere else in history. Local transactions are not
 * counted: while viewing, this client writes nothing.
 */
export function watchLiveChanges(
  doc: Y.Doc,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maps: readonly Y.AbstractType<any>[],
  onChange: (count: number) => void
): () => void {
  let count = 0;
  const handler = (tr: Y.Transaction) => {
    if (tr.local) return;
    const touched = maps.some((m) => tr.changed.has(m) || tr.changedParentTypes.has(m));
    if (!touched) return;
    count += 1;
    onChange(count);
  };
  doc.on('afterTransaction', handler);
  return () => doc.off('afterTransaction', handler);
}
