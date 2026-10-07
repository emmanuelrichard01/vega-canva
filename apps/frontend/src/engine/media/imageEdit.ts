import { nanoid } from 'nanoid';
import { applyNodePatches, roomId } from '../document';
import type { ImageNode } from '../model/schema';
import { notify } from '../ui/notices';
import { localSrcFor, registerLocalMedia } from '../../utils/pendingMedia';
import { cropToAspect, fillImage, fitImage, quarterTurn, replacementCrop } from './imageFrame';
import { uploadMedia } from './upload';

/**
 * The image edits the panel and rail offer, each one undo step.
 *
 * The geometry is in `imageFrame.ts`; this is the part that reads the node and
 * writes the answer. Every function is a no-op until the picture's own size is
 * known, because none of these can be right without it.
 */

const naturalOf = (node: ImageNode) => ({ width: node.naturalWidth ?? 0, height: node.naturalHeight ?? 0 });

/** Fit shows the whole picture; fill covers the box. */
export function setImageFrame(node: ImageNode, mode: 'fit' | 'fill'): boolean {
  const natural = naturalOf(node);
  if (mode === 'fit') {
    const out = fitImage(node, natural);
    if (!out) return false;
    applyNodePatches([{ id: node.id, changes: { ...out.box, crop: undefined } }]);
    return true;
  }
  const crop = fillImage(node, natural, node.crop);
  if (crop === null) return false;
  applyNodePatches([{ id: node.id, changes: { crop } }]);
  return true;
}

/** Crop to a preset's proportions; `null` puts the whole picture back. */
export function setImageAspect(node: ImageNode, ratio: number | null): boolean {
  const out = cropToAspect(node, naturalOf(node), node.crop, ratio);
  if (!out) return false;
  applyNodePatches([{ id: node.id, changes: { ...out.box, crop: out.crop } }]);
  return true;
}

export function turnImage(node: ImageNode, direction: 1 | -1): void {
  applyNodePatches([{ id: node.id, changes: { rotation: quarterTurn(node.rotation ?? 0, direction) } }]);
}

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

function measureFile(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

/**
 * Swap the picture and keep the frame: same place, same size, same corners,
 * border and shadow. A new picture of different proportions is cropped to fill
 * the frame rather than squashed into it.
 *
 * The new file shows at once from this device and uploads behind it, as a
 * dropped image does, so going offline queues it instead of losing it.
 */
export async function replaceImageFile(node: ImageNode, file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    notify({ tone: 'warning', message: 'That file is not a picture.' });
    return;
  }
  const uploadId = nanoid();
  const local = registerLocalMedia(uploadId, file);
  const natural = await measureFile(local);
  applyNodePatches([
    {
      id: node.id,
      changes: {
        src: localSrcFor(uploadId),
        naturalWidth: natural.width || undefined,
        naturalHeight: natural.height || undefined,
        crop: replacementCrop(node, natural),
      },
    },
  ]);
  const outcome = await uploadMedia({ uploadId, objectId: node.id, roomId, file, mediaType: 'image' });
  if (outcome === 'queued') notify({ tone: 'info', message: 'The new picture will upload when you are back online.' });
  else if (outcome === 'failed') notify({ tone: 'warning', message: 'The new picture could not be uploaded. Select it to see why and try again.' });
}
