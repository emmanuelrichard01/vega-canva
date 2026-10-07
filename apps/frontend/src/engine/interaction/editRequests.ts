/**
 * `requestEditNode` routing: one document listener for the board, dispatching
 * by id, rather than one listener per mounted object.
 */
const editRequestHandlers = new Map<string, () => void>();
let editRequestListening = false;

export function onEditRequest(id: string, handler: () => void): () => void {
  if (!editRequestListening && typeof document !== 'undefined') {
    editRequestListening = true;
    document.addEventListener('requestEditNode', (e: Event) => {
      const target = (e as CustomEvent<{ id: string }>).detail?.id;
      if (target) editRequestHandlers.get(target)?.();
    });
  }
  editRequestHandlers.set(id, handler);
  return () => {
    if (editRequestHandlers.get(id) === handler) editRequestHandlers.delete(id);
  };
}
