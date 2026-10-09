/**
 * Which container and codec a voice note is recorded in, and what its file is
 * called.
 *
 * ## Why AAC in MP4 comes first
 *
 * A note is recorded on one machine and played on everybody else's. Opus in
 * WebM is what Chrome and Firefox reach for by default, and older Safari and
 * iOS cannot decode it at all, so a note recorded in Chrome failed to load for
 * every collaborator on an iPhone. AAC in MP4 plays in every browser this app
 * supports. Chrome and Edge can record it now; Safari has always recorded it.
 * Firefox cannot, and falls through to Opus in WebM, its own native format.
 *
 * The empty string is the last resort: "whatever you would pick anyway", which
 * is better than refusing to record because no preferred type matched.
 */
export const PREFERRED_RECORDING_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg;codecs=opus',
  '',
] as const;

export function pickRecordingType(isTypeSupported: ((type: string) => boolean) | null | undefined): string {
  if (!isTypeSupported) return '';
  for (const type of PREFERRED_RECORDING_TYPES) {
    if (type === '') return '';
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      /* a browser that throws on a type does not support it */
    }
  }
  return '';
}

/** `audio/webm;codecs=opus` → `audio/webm`. Lower-cased, parameters dropped. */
export function baseAudioType(type: string | null | undefined): string {
  return (type ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * The type a finished take is labelled with.
 *
 * The recorder's own `mimeType` is the truth when it has one. Some builds
 * report an empty string, and then the first chunk's type is the next best
 * witness. A blob whose type contradicts its bytes is a note that will not
 * play back on the machine that made it, so guessing WebM is the last resort.
 */
export function recordedAudioType(recorderType: string | null | undefined, chunks: ReadonlyArray<{ type: string }>): string {
  if (recorderType && baseAudioType(recorderType).startsWith('audio/')) return recorderType;
  const fromChunk = chunks.find((c) => baseAudioType(c.type).startsWith('audio/'))?.type;
  if (fromChunk) return fromChunk;
  return 'audio/webm';
}

/**
 * The file extension for an audio type. MP4 audio is `.m4a`, which the server
 * accepts and serves as `audio/mp4`, and which an operating system opens as
 * audio rather than as a video with no picture.
 */
export function audioExtension(type: string | null | undefined): string {
  const base = baseAudioType(type);
  if (base === 'audio/mp4' || base === 'audio/x-m4a' || base === 'audio/aac') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mpeg') return 'mp3';
  if (base === 'audio/wav' || base === 'audio/x-wav') return 'wav';
  return 'webm';
}

/** The extension a stored URL ends in, when it names one this app records. */
export function extensionFromUrl(url: string): string | null {
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  if (ext === 'mp4') return 'm4a';
  return ['m4a', 'webm', 'ogg', 'mp3', 'wav', 'aac'].includes(ext) ? ext : null;
}

/**
 * The type a take is uploaded under: the bare type, in the spelling the
 * server's allow-list uses. Safari has labelled MP4 audio `audio/x-m4a`.
 */
export function uploadAudioType(type: string | null | undefined): string {
  const base = baseAudioType(type);
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4';
  if (base === 'audio/x-wav') return 'audio/wav';
  return base || 'audio/webm';
}
