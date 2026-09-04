import type { Exporter, ExportOptions, ExportFormat } from './ExportTypes';
import { useStore } from '../../hooks/useStore';
import { commentsMap, metadataMap, roomId as currentRoomId } from '../document';
import { roomFingerprint } from '../room/roomCode';
import { SCHEMA_VERSION } from '../model/schema';
import { EXPORT_ENVELOPE_VERSION } from './DocumentImport';
import { exportIdSet } from './exportScope';

export class JSONExporter implements Exporter {
  type: ExportFormat = "json";

  async export(options: ExportOptions): Promise<string> {
    const state = useStore.getState();

    let objects = state.objects;
    const idSet = exportIdSet(options);
    if (idSet) {
      objects = Object.fromEntries(Object.entries(state.objects).filter(([id]) => idSet.has(id)));
    }

    // Comments live in their own CRDT map (commentsMap), not in the objects
    // store — omitting them silently dropped every comment thread from every
    // export, audio notes included, since replies reference author/timestamps
    // that only exist here.
    const comments: any[] = [];
    commentsMap.forEach((thread) => comments.push(thread.toJSON()));

    /**
     * Where this came from, recorded in the file -- carefully.
     *
     * A backup that cannot say what it is a backup *of* is a bag of objects.
     * Restoring one used to offer "142 objects" and nothing else, so choosing
     * between two files in a downloads folder meant opening both.
     *
     * The obvious thing to write is the room id, and it must not be written.
     * The id is not a name, it is the capability: anyone holding it can open
     * the live board and change it. An export is a file people attach to
     * tickets and commit to repositories, and nothing about saving a backup
     * suggests you are publishing a key to the board it came from.
     *
     * So the title, which is what identifies the file to a person, and a
     * short one-way fingerprint, which is all that is needed to answer "is
     * this a backup of the board I am in?". See `roomFingerprint`.
     */
    // The document layer's answer, not a second parse of the path, which
    // returned null on an invite route and fingerprinted the export as
    // belonging to no board at all.
    const roomId = currentRoomId === 'home' ? null : currentRoomId;
    const title = metadataMap.get('name') ?? null;

    const documentData = {
      /**
       * The **file format** version, which is what the importer gates on.
       * Bump it only when the envelope below changes shape.
       */
      version: EXPORT_ENVELOPE_VERSION,
      exportedAt: new Date().toISOString(),
      /**
       * What the board was called. Restoring used to lose it: a backup of
       * "Q3 planning wall" came back as an untitled board, and the one field
       * that would have told you which file to pick was the one field the
       * exporter did not write.
       */
      title,
      room: roomId ? { fingerprint: roomFingerprint(roomId) } : null,
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
