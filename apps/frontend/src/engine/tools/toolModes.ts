/**
 * Two ways a tool stays in your hand for longer than it normally would.
 *
 * ## Keeping a tool armed
 *
 * Every tool that *places* something -- a shape, a note, a text box, a frame,
 * a grid, a chart, a table -- hands the board back to Select the moment its
 * object exists. That is right for the common case and a tax on the other one:
 * laying down twelve notes for a brainstorm, or a row of boxes for a diagram,
 * meant going back to the dock (or the key) twelve times.
 *
 * Every tool in the comparison set has an answer. Excalidraw has a padlock on
 * `Q`; Sketch and Illustrator keep an insert tool on a double-click. Both are
 * adopted: `Q` toggles it, and double-clicking the armed seat on the dock does
 * the same thing.
 *
 * The lock belongs to **one tool**, not to the session. Excalidraw's padlock
 * is global and it works there because the padlock is always on screen; here
 * it would be a hidden mode that followed you from the note tool to the
 * rectangle and surprised you on the second one. So it clears the moment
 * anything else is armed -- including Select, by Escape or `V` -- and a seat
 * wearing a padlock always means exactly that seat. "Tool" here means the
 * seat: changing from a rectangle to a diamond keeps it. See `lockFamily`.
 *
 * ## Holding a tool on its key
 *
 * The spring-loaded tool, from Photoshop and Illustrator: tap `E` and the
 * eraser is armed; *hold* `E`, rub something out, let go, and you are back on
 * the pencil you were drawing with. One gesture instead of three, and nothing
 * to remember afterwards. The tap stays exactly what it was, so nobody who
 * never holds a key sees any difference.
 *
 * The decision is made on release, by how long the key was down. Deciding on
 * a timer at keydown would make the tool change *under* a slow tap.
 *
 * ## Why a module and not the store
 *
 * Both are facts about one person's hands at one moment. In the document they
 * would sync; in the Zustand store they would sit beside state that mirrors the
 * document. `dockDefaults` makes the same call, and the dock reads this the same
 * way -- through `useSyncExternalStore`.
 */

type Listener = () => void;

export interface ToolModesSnapshot {
  /** The seat that stays armed after it has made something, or null. See `lockFamily`. */
  locked: string | null;
  /** The tool currently held on its key, once the hold has lasted long enough to count. */
  held: string | null;
}

/** How long a key must be down before letting go of it goes back. */
export const SPRING_MS = 300;

/**
 * Tools whose use ends by handing the board back to Select.
 *
 * The only ones a lock means anything for: the pencil, the eraser, the hand
 * and the connector already stay armed, so locking them would be a badge that
 * changes nothing.
 */
export function isLockable(toolId: string): boolean {
  return (
    toolId.startsWith('shape') ||
    toolId === 'frame' ||
    toolId.startsWith('frame-') ||
    toolId === 'text' ||
    toolId === 'sticky' ||
    toolId === 'chart' ||
    toolId === 'grid' ||
    toolId === 'table'
  );
}

/**
 * Tools that can be held on their key.
 *
 * Not the ones that open something the moment they are used: text and notes
 * put a caret in what they made, the image tool opens a file picker, audio
 * starts recording, a comment opens a thread, a table opens its cells. Letting
 * go of the key would then pull the tool out from under whatever just opened.
 */
export function isSpringable(toolId: string): boolean {
  return !['text', 'sticky', 'image', 'audio', 'comment', 'chart', 'table'].includes(toolId);
}

/**
 * What a lock is kept on: the seat, not the preset.
 *
 * Every shape preset is its own tool id -- `shape-rect`, `shape-ellipse` --
 * and so is every frame size. Keyed on the id, keeping the Shape tool lasted
 * exactly until you switched from a box to a circle on the shelf, which is the
 * moment a run of shapes most often changes: a flowchart is boxes *and*
 * diamonds. `R` arms a bare `shape`, which is the same seat again.
 *
 * Line and arrow are a seat of their own, as they are on the dock, so moving
 * from shapes to a connecting arrow ends the lock like any other change.
 */
export function lockFamily(toolId: string): string {
  if (toolId === 'shape-line' || toolId === 'shape-arrow') return 'line';
  if (toolId.startsWith('shape')) return 'shape';
  if (toolId === 'frame' || toolId.startsWith('frame-')) return 'frame';
  return toolId;
}

interface Hold {
  key: string;
  tool: string;
  /** The tool to go back to. */
  back: string;
  /** Whether `back` was locked, so the lock survives the round trip. */
  relock: boolean;
  since: number;
}

let active = 'select';
let locked: string | null = null;
let hold: Hold | null = null;
let heldVisible = false;
let promoteTimer: ReturnType<typeof setTimeout> | null = null;

let snapshot: ToolModesSnapshot = { locked: null, held: null };
const listeners = new Set<Listener>();

function emit() {
  const next = { locked, held: heldVisible && hold ? hold.tool : null };
  if (next.locked === snapshot.locked && next.held === snapshot.held) return;
  snapshot = next;
  listeners.forEach((fn) => fn());
}

function clearPromote() {
  if (promoteTimer !== null) {
    clearTimeout(promoteTimer);
    promoteTimer = null;
  }
}

export const toolModes = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Stable between changes, so `useSyncExternalStore` can skip renders. */
  getSnapshot: (): ToolModesSnapshot => snapshot,

  /**
   * Tell the modes which tool is armed. Called by the room on every change.
   *
   * This is what makes the lock belong to one tool: arming anything else ends
   * it. It also drops a hold the person has moved on from -- clicking another
   * seat while `E` is down is a choice, and letting go of `E` afterwards must
   * not undo it.
   */
  syncActive(toolId: string) {
    active = toolId;
    if (locked !== null && locked !== lockFamily(toolId)) locked = null;
    if (hold && toolId !== hold.tool) {
      hold = null;
      heldVisible = false;
      clearPromote();
    }
    emit();
  },

  /** Keep the armed tool, or stop keeping it. False when it has nothing to keep. */
  toggleLock(): boolean {
    if (!isLockable(active)) return false;
    const seat = lockFamily(active);
    locked = locked === seat ? null : seat;
    emit();
    return true;
  },

  isLocked: (toolId: string): boolean => locked !== null && locked === lockFamily(toolId),

  /**
   * Keep a seat, or stop keeping it, whether or not it is armed yet.
   *
   * `toggleLock` acts on the armed tool, which is right for `Q`. A padlock in a
   * seat's menu is pressed *before* the seat is armed -- the click arms it and
   * keeps it in one act -- and arming goes through the room's state, so the
   * sync that tells this module about it lands a render later. Setting the lock
   * by seat first means that sync finds it already pointing at the tool it is
   * arming, and keeps it.
   */
  keep(toolId: string, on: boolean) {
    if (!isLockable(toolId)) return;
    const seat = lockFamily(toolId);
    if (on) locked = seat;
    else if (locked === seat) locked = null;
    emit();
  },

  /**
   * A key went down for `tool` while `from` was armed.
   *
   * Returns nothing: the caller arms the tool exactly as a tap always has, and
   * only the release decides whether this was a hold.
   */
  beginHold(key: string, tool: string, from: string, at: number) {
    if (hold) return;
    if (tool === from || !isSpringable(tool)) return;
    hold = { key, tool, back: from, relock: locked !== null && locked === lockFamily(from), since: at };
    heldVisible = false;
    clearPromote();
    // Only for the dock, which shows a held tool differently from an armed
    // one. The decision itself is made from the timestamps in `endHold`.
    promoteTimer = setTimeout(() => {
      promoteTimer = null;
      if (!hold) return;
      heldVisible = true;
      emit();
    }, SPRING_MS);
  },

  /**
   * The key for a hold came back up.
   *
   * Returns the tool to go back to, or null when it was a tap and the tool it
   * armed should stay.
   */
  endHold(key: string, at: number): string | null {
    if (!hold || hold.key !== key) return null;
    const ended = hold;
    hold = null;
    heldVisible = false;
    clearPromote();
    if (at - ended.since < SPRING_MS) {
      emit();
      return null;
    }
    // Restored before the room re-arms `back`, so the sync that follows finds
    // the lock already pointing at the tool it is arming and keeps it.
    if (ended.relock) locked = lockFamily(ended.back);
    emit();
    return ended.back;
  },

  /** The window lost focus mid-hold. Treated as letting go. */
  releaseAll(at: number): string | null {
    return hold ? toolModes.endHold(hold.key, at) : null;
  },

  /** For tests: forget everything. */
  reset() {
    active = 'select';
    locked = null;
    hold = null;
    heldVisible = false;
    clearPromote();
    snapshot = { locked: null, held: null };
  },
};

/**
 * What a placing tool calls when its object exists.
 *
 * Replaces the `legacy_tool_change` to Select that each of them dispatched on
 * its own -- nine copies of one line, which is why no lock could exist: there
 * was no single place that decided whether a tool hands the board back.
 */
export function finishCreation() {
  if (locked !== null && locked === lockFamily(active)) return;
  window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
}
