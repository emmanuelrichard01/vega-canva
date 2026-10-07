import { nanoid } from 'nanoid';
import { editor } from '../../../engine/api/EditorAPI';
import { roomId } from '../../../engine/document';
import { uploadMedia } from '../../../engine/media/upload';
import type { ImageNode } from '../../../engine/model/schema';
import { notify } from '../../../engine/ui/notices';
import { measureImage } from '../../../hooks/useCanvasDropZone';
import { isLocalSrc, localSrcFor, registerLocalMedia, resolveLocalSrc } from '../../../utils/pendingMedia';

/** Ask for one image file. Resolves null when the picker is dismissed. */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Swap the picture inside an image, keeping where it is and how big it is.
 *
 * The crop is reset, because a crop rectangle belongs to the picture it was
 * drawn on. The new file shows at once from this device and uploads behind it,
 * the same way a dropped image does, so going offline queues it rather than
 * losing it.
 */
export async function replaceImage(node: ImageNode, file: File): Promise<void> {
  const uploadId = nanoid();
  const local = registerLocalMedia(uploadId, file);
  const measured = await measureImage(local);
  editor.updateNode(node.id, {
    src: localSrcFor(uploadId),
    naturalWidth: measured.width,
    naturalHeight: measured.height,
    crop: undefined,
  } as never);
  const outcome = await uploadMedia({ uploadId, objectId: node.id, roomId, file, mediaType: 'image' });
  if (outcome === 'queued') notify({ tone: 'info', message: 'The new image will upload when you are back online.' });
  else if (outcome === 'failed') notify({ tone: 'warning', message: 'The new image could not be uploaded. Select it to see why and try again.' });
}

/** Where the picture can be downloaded from right now: its uploaded URL, or the copy on this device. */
export function downloadableSrc(src: string | undefined): string | null {
  if (!src) return null;
  if (isLocalSrc(src)) return resolveLocalSrc(src);
  return src;
}
