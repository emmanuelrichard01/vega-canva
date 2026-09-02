import { useState, useCallback, useEffect } from 'react';
import { notify } from '../engine/ui/notices';
import { nanoid } from 'nanoid';
import { editor } from '../engine/api/EditorAPI';
import { cameraSystem } from '../engine/CameraSystem';
import { doc, localAuthor, updateNode } from '../engine/document';
import { calculateOptimalAudioWidth } from '../engine/model/audioPlayback';
import { mediaUploadUrl } from '../utils/endpoints';
import { hydratePendingMedia, processOfflineMediaQueue, queueOfflineMedia } from '../utils/offlineMediaQueue';
import { localSrcFor, registerLocalMedia, releaseLocalMedia } from '../utils/pendingMedia';
import { cellAtPoint, freeCellsFrom, gridAtPoint, placeImageInCell } from '../engine/grid/gridSlotApply';
import { importSvg } from '../engine/clipboard/svgImport';

const IMAGE_PLACE_MAX = 800;
const MULTI_PLACE_STEP = 24;

export const measureImage = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 300, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 300, height: 300 });
    img.src = url;
  });

interface UseCanvasDropZoneOptions {
  roomId: string;
  status: string;
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
}

/**
 * What to call a file in a message.
 *
 * The name where there is a usable one, the kind where there is not -- a
 * 40-character hash in a corner notice is noise, and "Your image" is the part
 * the reader actually needs to match against what they just dropped.
 */
function fileLabel(file: File): string {
  const name = file.name?.trim();
  if (name && name.length <= 32) return name;
  return file.type.startsWith('image/') ? 'That image' : 'That file';
}

export function useCanvasDropZone({ roomId, status, setSelectedIds }: UseCanvasDropZoneOptions) {
  const [dropActive, setDropActive] = useState(false);

  // Unconditional, and before anything about the network is known: the bytes
  // are on this device either way, and the case that hurts is precisely the
  // one where the connection never comes back.
  useEffect(() => {
    hydratePendingMedia();
  }, []);

  useEffect(() => {
    if (status === 'connected') {
      processOfflineMediaQueue();
    }
  }, [status]);

  const placeFile = useCallback(
    async (
      file: File,
      at?: { x: number; y: number },
      index = 0,
      /**
       * The grid module this file was dropped on, when it was dropped on one.
       *
       * Passed down rather than worked out here so that a drop of six
       * photographs onto one grid resolves the target **once**, from the
       * pointer, instead of six times from six different node positions — the
       * first picture placed would otherwise change what the second one found
       * underneath it.
       */
      slot?: { gridId: string; cell: number }
    ) => {
      const viewCenter = at ?? cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);

      // If dropped file is an SVG, import as native vector nodes
      if (file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml') {
        try {
          const text = await file.text();
          const art = importSvg(text);
          if (art && art.nodes.length > 0) {
            const originX = viewCenter.x - art.width / 2 + index * MULTI_PLACE_STEP;
            const originY = viewCenter.y - art.height / 2 + index * MULTI_PLACE_STEP;
            const madeIds: string[] = [];

            doc.transact(() => {
              for (const node of art.nodes) {
                const id = nanoid();
                madeIds.push(id);
                editor.createNode({
                  ...node,
                  id,
                  x: (node.x as number) + originX,
                  y: (node.y as number) + originY,
                } as never);
              }
            });

            setSelectedIds((current) =>
              index === 0 ? madeIds : Array.from(new Set([...current, ...madeIds]))
            );
            return;
          }
        } catch (e) {
          console.warn('SVG vector parsing failed, falling back to raster image', e);
        }
      }

      /**
       * The id the local bytes hang off, decided before the node exists.
       *
       * It is the queue's key *and* the `local:` src the document carries, so
       * there is one identifier for "this pending upload" rather than two that
       * have to be kept in step. `queueOfflineMedia` is handed this same id
       * below on the offline path.
       */
      const uploadId = nanoid();
      const localUrl = registerLocalMedia(uploadId, file);
      const type = file.type.startsWith('image/') ? 'image' : 'audio';
      const measured = type === 'image' ? await measureImage(localUrl) : null;
      const author = localAuthor();

      let width = type === 'image' ? 300 : calculateOptimalAudioWidth(author.name);
      let height = type === 'image' ? 300 : 64;
      if (measured) {
        const fit = Math.min(IMAGE_PLACE_MAX / measured.width, IMAGE_PLACE_MAX / measured.height, 1);
        width = Math.max(1, Math.round(measured.width * fit));
        height = Math.max(1, Math.round(measured.height * fit));
      }

      const objId = editor.createNode({
        id: nanoid(),
        type,
        x: viewCenter.x - width / 2 + index * MULTI_PLACE_STEP,
        y: viewCenter.y - height / 2 + index * MULTI_PLACE_STEP,
        width,
        height,
        /**
         * `local:<id>`, never the blob URL.
         *
         * A `blob:` URL resolves only in the tab that minted it, so writing
         * one here published a picture nobody else could load and left a dead
         * string in the persisted document for the author to reopen. See
         * `pendingMedia.ts` -- the document may only hold a URL that means the
         * same thing to every reader.
         */
        src: localSrcFor(uploadId),
        ...(measured ? { naturalWidth: measured.width, naturalHeight: measured.height } : {}),
        ...(type === 'audio'
          ? { durationMs: 0, waveform: [], author }
          : { appearance: {} }),
      });

      /**
       * Land it on the module before anything else looks at it.
       *
       * `editor.createNode` writes through Yjs, whose observers fire
       * synchronously, so the store already holds this node — and the natural
       * size was measured above, which means the cover crop is right on the
       * first paint rather than one reflow later.
       */
      if (slot && type === 'image') placeImageInCell(slot.gridId, slot.cell, objId);

      setSelectedIds((current) =>
        index === 0 ? [objId] : current.includes(objId) ? current : [...current, objId]
      );

      /**
       * Uploading, and saying so when it does not work.
       *
       * The object is already on the board, drawn from a local blob URL, so
       * every failure below *looks* like success until the page is reloaded
       * and the picture is gone. That is the worst shape a failure can take,
       * and this had two of them: `if (data.url)` had no `else`, so a server
       * rejection -- a 413 over the room's storage quota, a refused file type
       * -- did nothing at all, and the network `catch` queued the file for
       * later without a word.
       *
       * Which of the two matters is the distinction the messages draw. A
       * queued upload is fine and needs reassurance, not an alarm. A rejection
       * is permanent for this file and the person has to know now, while they
       * still remember what they dropped.
       */
      try {
        const formData = new FormData();
        formData.append('media', file);
        const res = await fetch(mediaUploadUrl(roomId), {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          // The server's own words where it gave any: it knows whether this
          // was a quota, a file type or a rate limit, and a generic
          // "upload failed" would throw that away.
          const reason = await res
            .json()
            .then((body) => (typeof body?.error === 'string' ? body.error : null))
            .catch(() => null);
          notify({
            tone: 'warning',
            message: reason ?? `${fileLabel(file)} could not be uploaded.`,
          });
          return;
        }

        const data = await res.json();
        if (!data?.url) {
          notify({
            tone: 'warning',
            message: `${fileLabel(file)} was not saved. It will disappear when you reload.`,
          });
          return;
        }

        updateNode(objId, { src: data.url });
        // After the write, not before: releasing first blanks the picture for
        // as long as the document takes to come back round.
        releaseLocalMedia(uploadId);
      } catch (err) {
        console.warn('Network upload failed, queuing offline media for sync...', err);
        queueOfflineMedia({
          // The same id the `local:` src already names, so a reload can find
          // these bytes from the node alone.
          id: uploadId,
          objectId: objId,
          roomId,
          fileBlob: file,
          fileName: file.name,
          fileType: file.type,
          mediaType: type as 'image' | 'audio',
        });
        // `info`, not `warning`: nothing is lost and nothing is required of
        // the reader. It is the quietest tone that still answers "did that
        // work?", which is the question an unexplained pause creates.
        notify({ tone: 'info', message: `${fileLabel(file)} will upload when you are back online.` });
      }
    },
    [roomId, setSelectedIds]
  );

  const placeFiles = useCallback(
    async (files: FileList | File[], at?: { x: number; y: number }) => {
      const list = Array.from(files);
      const usable = list.filter((f) => f.type.startsWith('image/') || f.type.startsWith('audio/'));
      if (usable.length === 0) return;

      /**
       * Dropping onto a grid fills it from the module you aimed at.
       *
       * Resolved once, before anything is created, for the reason given on
       * `placeFile`'s `slot` argument. Free modules are taken in reading order
       * from the target onwards and wrap round to the start, so dropping a
       * folder of photographs onto the middle of an empty grid fills it
       * completely rather than filling only the half below the pointer.
       *
       * Audio is excluded on purpose: a module is a picture frame, and a voice
       * note in one would be a player squashed to whatever shape the grid
       * happened to make. Dropped audio lands on the board as it always did.
       */
      const grid = at ? gridAtPoint(at) : null;
      const startCell = grid ? cellAtPoint(grid, at!) : null;
      const freeCells =
        grid && startCell !== null ? freeCellsFrom(grid.id, startCell) : [];

      let slotted = 0;
      for (let i = 0; i < usable.length; i++) {
        const isImage = usable[i].type.startsWith('image/');
        const cell = isImage ? freeCells[slotted] : undefined;
        if (cell !== undefined) slotted += 1;
        await placeFile(
          usable[i],
          at,
          i,
          grid && cell !== undefined ? { gridId: grid.id, cell } : undefined
        );
      }
    },
    [placeFile]
  );

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDropActive(false);
    };

    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      setDropActive(false);
      if (files.length === 0) return;
      e.preventDefault();
      const stage = document.querySelector('.konvajs-content')?.getBoundingClientRect();
      const at = stage
        ? cameraSystem.screenToWorld(e.clientX - stage.left, e.clientY - stage.top)
        : undefined;
      void placeFiles(files, at);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [placeFiles]);

  return {
    dropActive,
    placeFile,
    placeFiles,
  };
}
