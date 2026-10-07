import { isLocalSrc, resolveLocalSrc } from '../../../utils/pendingMedia';

/** Where the picture can be downloaded from right now: its uploaded URL, or the copy on this device. */
export function downloadableSrc(src: string | undefined): string | null {
  if (!src) return null;
  if (isLocalSrc(src)) return resolveLocalSrc(src);
  return src;
}
