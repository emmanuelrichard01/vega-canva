import type { Exporter, ExportOptions, ExportFormat } from './ExportTypes';
import { useStore } from '../../hooks/useStore';
import { commentsMap } from '../document';
import { SCHEMA_VERSION } from '../model/schema';
import { EXPORT_ENVELOPE_VERSION } from './DocumentImport';

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
      /**
       * The **file format** version, which is what the importer gates on.
       * Bump it only when the envelope below changes shape.
       */
      version: EXPORT_ENVELOPE_VERSION,
      exportedAt: new Date().toISOString(),
      editorVersion: "1.0",
      /**
       * The **node schema** version, which is a different thing and was not
       * recorded at all.
       *
       * The envelope has said `version: 1` since the first commit while the
       * nodes inside it moved through three schema revisions — so two files a
       * year apart, containing materially different node shapes, were
       * indistinguishable to any reader. Migration runs off the stored document
       * version, and a restore had nothing to tell it which one applied.
       *
       * Written from `SCHEMA_VERSION` rather than typed, so it cannot fall
       * behind the schema it describes.
       */
      schemaVersion: SCHEMA_VERSION,
      objects,
      comments,
      metadata: {
        selectedOnly: options.selectedOnly || false,
        /** How many of each, so a file can be sized up without parsing it all. */
        objectCount: Object.keys(objects).length,
        commentCount: comments.length,
      }
    };

    return JSON.stringify(documentData, null, 2);
  }
}
