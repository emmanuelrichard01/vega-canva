import { roomId, registerBoardFont, localAuthor, type BoardFont } from '../document';
import { mediaUploadUrl, roomRequestHeaders } from '../../utils/endpoints';
import { canonicalFontFile, cleanFamilyName, FontFileError, inspectFontFile, type FontFileInfo } from './fontFile';
import { isBuiltInFamily } from './fontCatalogue';
import { localFamilyBlobs } from './localFonts';

/**
 * Putting a font on the board: check it, upload it through the media route,
 * and register it so every collaborator loads it.
 */

/**
 * The family name an upload is registered under.
 *
 * A face that shares a name with a built-in family is registered as "(Uploaded)",
 * because the built-in entry would otherwise win and the upload would never
 * be drawn.
 */
export function boardFamilyName(family: string): string {
  return isBuiltInFamily(family) ? `${family} (Uploaded)` : family;
}

export interface UploadedFace {
  font: BoardFont;
  info: FontFileInfo;
}

async function send(file: File): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append('media', file);
  let res: Response;
  try {
    res = await fetch(mediaUploadUrl(roomId), { method: 'POST', headers: roomRequestHeaders(), body: form });
  } catch {
    throw new FontFileError('The upload could not reach the server. Check the connection and try again.');
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: string };
  if (!res.ok || !body.id || !body.url) {
    throw new FontFileError(body.error || `The server refused the font (${res.status}).`);
  }
  return { id: body.id, url: body.url };
}

/**
 * Upload one font file and add it to the board.
 *
 * @throws {FontFileError} with a sentence to show the person.
 */
export async function uploadFontFile(file: File, familyOverride?: string): Promise<UploadedFace> {
  const info = await inspectFontFile(file);
  const family = boardFamilyName(cleanFamilyName(familyOverride) || info.family);
  const { id, url } = await send(canonicalFontFile(file, info));
  const font: BoardFont = {
    id,
    family,
    style: info.style,
    weight: info.weight,
    italic: info.italic,
    ...(info.weightMin !== undefined ? { weightMin: info.weightMin, weightMax: info.weightMax } : {}),
    url,
    format: info.format,
    sizeBytes: info.sizeBytes,
    uploadedBy: localAuthor().name,
    uploadedAt: Date.now(),
  };
  if (!registerBoardFont(font)) {
    throw new FontFileError('Only editors can add fonts to this board.');
  }
  return { font, info };
}

/**
 * Share a font installed on this device with the board, every style of it.
 * Runs only when the person asks; nothing local is uploaded otherwise.
 */
export async function shareLocalFamily(family: string): Promise<{ uploaded: number; errors: string[] }> {
  const faces = await localFamilyBlobs(family);
  const errors: string[] = [];
  let uploaded = 0;
  for (const { style, blob } of faces) {
    const file = new File([blob], `${family}-${style}.ttf`, { type: blob.type });
    try {
      await uploadFontFile(file, family);
      uploaded += 1;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `${family} ${style} could not be shared.`);
    }
  }
  if (!faces.length) errors.push(`${family} could not be read from this device.`);
  return { uploaded, errors };
}
