import type { Exporter, ExportOptions, ExportFormat } from './ExportTypes';
import { useStore } from '../../hooks/useStore';
import { commentsMap } from '../document';

export class JSONExporter implements Exporter {
  type: ExportFormat = "json";

  async export(options: ExportOptions): Promise<string> {
    const state = useStore.getState();

    let objects = state.objects;
    if (options.selectedOnly && options.selectedIds?.length) {
      const idSet = new Set(options.selectedIds);
      objects = Object.fromEntries(Object.entries(state.objects).filter(([id]) => idSet.has(id)));
    }

    // Comments live in their own CRDT map (commentsMap), not in the objects
    // store — omitting them silently dropped every comment thread from every
    // export, audio notes included, since replies reference author/timestamps
    // that only exist here.
    const comments: any[] = [];
    commentsMap.forEach((thread) => comments.push(thread.toJSON()));

    const documentData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      editorVersion: "1.0",
      objects,
      comments,
      metadata: {
        selectedOnly: options.selectedOnly || false,
      }
    };

    return JSON.stringify(documentData, null, 2);
  }
}
