import { useState, useCallback, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { editor } from '../engine/api/EditorAPI';
import { cameraSystem } from '../engine/CameraSystem';
import { localAuthor, updateNode } from '../engine/document';
import { calculateOptimalAudioWidth } from '../engine/model/audioPlayback';
import { mediaUploadUrl } from '../utils/endpoints';
import { processOfflineMediaQueue, queueOfflineMedia } from '../utils/offlineMediaQueue';

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

export function useCanvasDropZone({ roomId, status, setSelectedIds }: UseCanvasDropZoneOptions) {
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    if (status === 'connected') {
      processOfflineMediaQueue();
    }
  }, [status]);

  const placeFile = useCallback(
    async (file: File, at?: { x: number; y: number }, index = 0) => {
      const localUrl = URL.createObjectURL(file);
      const type = file.type.startsWith('image/') ? 'image' : 'audio';
      const measured = type === 'image' ? await measureImage(localUrl) : null;
      const viewCenter = at ?? cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
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
        src: localUrl,
        ...(measured ? { naturalWidth: measured.width, naturalHeight: measured.height } : {}),
        ...(type === 'audio'
          ? { durationMs: 0, waveform: [], author }
          : { appearance: {} }),
      });

      setSelectedIds((current) =>
        index === 0 ? [objId] : current.includes(objId) ? current : [...current, objId]
      );

      try {
        const formData = new FormData();
        formData.append('media', file);
        const res = await fetch(mediaUploadUrl(roomId), {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (data.url) {
          updateNode(objId, { src: data.url });
          URL.revokeObjectURL(localUrl);
        }
      } catch (err) {
        console.warn('Network upload failed, queuing offline media for sync...', err);
        queueOfflineMedia({
          id: nanoid(),
          objectId: objId,
          roomId,
          fileBlob: file,
          fileName: file.name,
          fileType: file.type,
          mediaType: type as 'image' | 'audio',
        });
      }
    },
    [roomId, setSelectedIds]
  );

  const placeFiles = useCallback(
    async (files: FileList | File[], at?: { x: number; y: number }) => {
      const list = Array.from(files);
      const usable = list.filter((f) => f.type.startsWith('image/') || f.type.startsWith('audio/'));
      if (usable.length === 0) return;
      for (let i = 0; i < usable.length; i++) {
        await placeFile(usable[i], at, i);
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
