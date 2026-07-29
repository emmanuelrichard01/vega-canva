/**
 * Endpoint resolution.
 *
 * Every API and WebSocket URL used to be hardcoded to `localhost:3000`. That works
 * in two tabs on one machine and fails the moment the room link is opened anywhere
 * else — a second laptop resolves `localhost` to *itself*, where nothing is running.
 * Since sharing a link with another person is the core feature, this has to derive
 * from wherever the page was actually served.
 *
 * Override with VITE_SERVER_HOST / VITE_WS_URL when frontend and server aren't on
 * the same host (e.g. a deployed frontend pointing at a remote sync server).
 */

const env = (import.meta as any).env || {};

/** Host the browser used to load the app, e.g. "localhost" or "192.168.1.42". */
const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

const SERVER_HOST: string = env.VITE_SERVER_HOST || `${currentHost}:3000`;

/** HTTP base for REST endpoints (media upload, history). */
export const API_BASE: string = env.VITE_API_URL || `${window.location.protocol}//${SERVER_HOST}`;

/** WebSocket base for Hocuspocus sync. Matches page protocol so HTTPS pages use WSS. */
export const WS_URL: string =
  env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${SERVER_HOST}`;

export const mediaUploadUrl = (roomId: string) => `${API_BASE}/rooms/${roomId}/media`;
export const roomHistoryUrl = (roomId: string) => `${API_BASE}/rooms/${roomId}/history`;
