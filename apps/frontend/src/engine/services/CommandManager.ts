import { nanoid } from 'nanoid';
import {
  createNode as writeCreate,
  deleteNode as writeDelete,
  undoManager,
  updateNode as writeUpdate,
  type NewNodeInput,
} from '../document';
import { historyService } from './HistoryService';

/**
 * The semantic command layer.
 *
 * Commands describe *intent* ("create a node", "move these") and are what the
 * activity feed and Time Travel narrate. They do not implement persistence —
 * every one delegates to `engine/document/mutations`, which is the single
 * write path. Previously each command hand-rolled its own `Y.Map` assembly
 * and `objectsMap.set`, which is how base-field stamping (z-index, updatedAt,
 * authorship) ended up inconsistent between the command layer and the tools
 * that bypassed it.
 *
 * Undo/redo is delegated to Yjs' `UndoManager`, which tracks the document
 * itself and therefore also covers mutations that never went through a
 * command (drag commits, physics settles).
 */
export interface Command {
  id: string;
  name: string;
  execute(): void;
}

class BaseCommand implements Command {
  id = nanoid();
  name = 'Unknown Command';
  execute() {}
}

export class CreateNodeCommand extends BaseCommand {
  name = 'Create Node';
  /** Populated by execute(), so callers can read the id the document assigned. */
  createdId: string | null = null;
  private node: NewNodeInput;

  constructor(node: NewNodeInput) {
    super();
    this.node = node;
  }

  execute() {
    this.createdId = writeCreate(this.node);
    historyService.pushCommand(this.name, { nodeId: this.createdId, type: this.node.type });
  }
}

export class UpdateNodeCommand extends BaseCommand {
  name = 'Update Node';
  private nodeId: string;
  private updates: Record<string, unknown>;

  constructor(nodeId: string, updates: Record<string, unknown>) {
    super();
    this.nodeId = nodeId;
    this.updates = updates;
  }

  execute() {
    writeUpdate(this.nodeId, this.updates);
    historyService.pushCommand(this.name, { nodeId: this.nodeId, updates: this.updates });
  }
}

export class DeleteNodeCommand extends BaseCommand {
  name = 'Delete Node';
  private nodeId: string;

  constructor(nodeId: string) {
    super();
    this.nodeId = nodeId;
  }

  execute() {
    writeDelete(this.nodeId);
    historyService.pushCommand(this.name, { nodeId: this.nodeId });
  }
}

export class CommandManager {
  execute(command: Command) {
    command.execute();
  }

  undo() {
    undoManager.undo();
  }

  redo() {
    undoManager.redo();
  }
}

export const commandManager = new CommandManager();
