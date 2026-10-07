import { useSyncExternalStore } from 'react';
import { readNode, updateNode } from '../document';
import { mediaUploadUrl, roomRequestHeaders } from '../../utils/endpoints';
import { queueOfflineMedia } from '../../utils/offlineMediaQueue';
import { localSrcFor, releaseLocalMedia, uploadIdFromSrc } from '../../utils/pendingMedia';

/**
 * Media uploads, with progress, failure and retry.
 *
 * A dropped image or a recorded voice note is placed on the board at once,
 * drawn from a `local:<uploadId>` object URL, and uploaded in the background.
 * This module owns that background half and publishes where each upload is,
 * so the canvas can draw a progress hairline over the object and offer Retry
 * when the server says no.
 *
 * Outcomes:
 * - **done**: the node's `src` is swapped for the stored URL and the local
 *   bytes are released.
 * - **queued**: the network is down. The bytes go to the offline queue, which
 *   uploads them after the next sync.
 * - **failed**: the server answered and refused (quota, size, permission) or
 *   errored. The bytes stay on this device and Retry tries again.
 */

export type UploadState =
  | { phase: 'uploading'; loaded: number; total: number }
  | { phase: 'queued' }
  | { phase: 'failed'; reason: string };

export interface UploadRequest {
  uploadId: string;
  objectId: string;
  roomId: string;
  file: File;
  mediaType: 'image' | 'audio';
}

export type UploadOutcome = 'done' | 'queued' | 'failed';

/** What the transport reports back. `status` 0 means the request never reached a server. */
export interface TransportResult {
  status: number;
  body: unknown;
}

export type Transport = (
  url: string,
  form: FormData,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void
) => Promise<TransportResult>;

/** XMLHttpRequest, because `fetch` cannot report upload progress. */
export const xhrTransport: Transport = (url, form, headers, onProgress) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ status: 0, body: null });
    xhr.onabort = () => resolve({ status: 0, body: null });
    xhr.send(form);
  });

const states = new Map<string, UploadState>();
const requests = new Map<string, UploadRequest>();
const listeners = new Set<() => void>();
let version = 0;

function publish(uploadId: string, state: UploadState | null): void {
  if (state) states.set(uploadId, state);
  else states.delete(uploadId);
  version += 1;
  listeners.forEach((fn) => fn());
}

export function getUploadState(uploadId: string): UploadState | null {
  return states.get(uploadId) ?? null;
}

export function subscribeUploads(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getVersion = () => version;

/** The upload state behind a node's `src`, or null when it is not a local upload. */
export function useUploadState(src: string | undefined): UploadState | null {
  useSyncExternalStore(subscribeUploads, getVersion, getVersion);
  const id = src ? uploadIdFromSrc(src) : null;
  return id ? getUploadState(id) : null;
}

/** The fraction uploaded, 0..1, or null when nothing is uploading. */
export function uploadFraction(state: UploadState | null): number | null {
  if (!state || state.phase !== 'uploading') return null;
  if (state.total <= 0) return 0;
  return Math.min(1, Math.max(0, state.loaded / state.total));
}

function serverReason(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error.trim() ? error.trim() : null;
}

/**
 * Upload one file and settle the node it belongs to.
 *
 * The node is only rewritten while it still holds this upload's local src:
 * a node deleted, or given another picture, while the bytes were in flight
 * keeps what it has now.
 */
export async function uploadMedia(req: UploadRequest, transport: Transport = xhrTransport): Promise<UploadOutcome> {
  requests.set(req.uploadId, req);
  publish(req.uploadId, { phase: 'uploading', loaded: 0, total: req.file.size });

  const form = new FormData();
  form.append('media', req.file);

  const result = await transport(mediaUploadUrl(req.roomId), form, roomRequestHeaders(), (loaded, total) =>
    publish(req.uploadId, { phase: 'uploading', loaded, total })
  );

  if (result.status === 0) {
    await queueOfflineMedia({
      id: req.uploadId,
      objectId: req.objectId,
      roomId: req.roomId,
      fileBlob: req.file,
      fileName: req.file.name,
      fileType: req.file.type,
      mediaType: req.mediaType,
    });
    publish(req.uploadId, { phase: 'queued' });
    return 'queued';
  }

  const url = (result.body as { url?: unknown } | null)?.url;
  if (result.status >= 200 && result.status < 300 && typeof url === 'string' && url) {
    const node = readNode(req.objectId) as { src?: string } | null;
    if (node && node.src === localSrcFor(req.uploadId)) updateNode(req.objectId, { src: url });
    releaseLocalMedia(req.uploadId);
    requests.delete(req.uploadId);
    publish(req.uploadId, null);
    return 'done';
  }

  const reason =
    serverReason(result.body) ??
    (result.status === 413
      ? 'This file is larger than the board accepts.'
      : result.status >= 500
        ? 'The server could not store this file.'
        : 'The upload was refused.');
  publish(req.uploadId, { phase: 'failed', reason });
  return 'failed';
}

/** Try a failed upload again. Returns null when this device no longer holds the bytes. */
export function retryUpload(uploadId: string, transport?: Transport): Promise<UploadOutcome> | null {
  const req = requests.get(uploadId);
  if (!req) return null;
  return uploadMedia(req, transport);
}

export function canRetryUpload(uploadId: string): boolean {
  return requests.has(uploadId) && states.get(uploadId)?.phase === 'failed';
}

export function __resetUploads(): void {
  states.clear();
  requests.clear();
  listeners.clear();
  version = 0;
}
