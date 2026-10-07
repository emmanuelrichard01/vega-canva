/**
 * A physics session: everything done between arming a force and leaving.
 *
 * Settled bodies are written to the document as they come to rest, which can
 * be minutes apart. The undo manager would turn each into its own step, and
 * undoing a shockwave would take a dozen presses. For the length of a session
 * the manager is told to keep merging, so the whole session is one step; ending
 * it closes that step and restores the normal window.
 *
 * Takes the undo manager as an argument so it can be exercised against a bare
 * Y.UndoManager with no provider or room.
 */
export interface UndoCapture {
  captureTimeout: number;
  stopCapturing(): void;
}

export class PhysicsSession {
  private saved: number | null = null;
  private readonly undo: UndoCapture;

  constructor(undo: UndoCapture) {
    this.undo = undo;
  }

  get active(): boolean {
    return this.saved !== null;
  }

  begin(): void {
    if (this.saved !== null) return;
    // Close whatever was being typed or dragged first, so the session never
    // swallows an unrelated edit made just before it.
    this.undo.stopCapturing();
    this.saved = this.undo.captureTimeout;
    this.undo.captureTimeout = Number.POSITIVE_INFINITY;
  }

  end(): void {
    if (this.saved === null) return;
    this.undo.captureTimeout = this.saved;
    this.saved = null;
    this.undo.stopCapturing();
  }
}
