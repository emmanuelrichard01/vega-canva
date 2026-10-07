/**
 * Where Spotify audio plays, in order of preference:
 *
 * 1. In this tab, through the Web Playback SDK (Spotify Premium and the
 *    `streaming` scope). The SDK script loads from sdk.scdn.co only when
 *    someone first plays.
 * 2. On one of the person's own Spotify devices, through the Connect API.
 *    Spotify allows playback control for Premium accounts only.
 * 3. Spotify's embed player, which plays previews for free accounts.
 *
 * `planPlayback` picks the route; it is pure so the choice is testable.
 */
import { accessToken } from './auth';

export type PlaybackRoute = { kind: 'sdk' } | { kind: 'device'; deviceId: string; name: string } | { kind: 'embed' };

export function planPlayback(opts: {
  premium: boolean;
  sdkDeviceId: string | null;
  devices: { id: string; name: string; isActive: boolean }[];
  /** A device the person picked, used when it is still open. */
  preferredDeviceId?: string | null;
}): PlaybackRoute {
  if (!opts.premium) return { kind: 'embed' };
  const chosen = opts.preferredDeviceId ? opts.devices.find((d) => d.id === opts.preferredDeviceId) : undefined;
  if (chosen) return { kind: 'device', deviceId: chosen.id, name: chosen.name };
  if (opts.sdkDeviceId) return { kind: 'sdk' };
  const device = opts.devices.find((d) => d.isActive) ?? opts.devices[0];
  if (device) return { kind: 'device', deviceId: device.id, name: device.name };
  return { kind: 'embed' };
}

interface SpotifyPlayerLike {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (arg: { device_id?: string; message?: string } & Record<string, unknown>) => void): void;
  setVolume(v: number): Promise<void>;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  activateElement?(): Promise<void>;
  seek(ms: number): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  removeListener?(event: string): void;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: { Player: new (opts: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume?: number }) => SpotifyPlayerLike };
  }
}

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';
/** The SDK script is abandoned if it has not loaded and announced itself by now. */
const SDK_LOAD_MS = 10_000;
let sdkLoad: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      sdkLoad = null;
      reject(new Error('The Spotify player could not load.'));
    };
    const timer = setTimeout(fail, SDK_LOAD_MS);
    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timer);
      resolve();
    };
    script.src = SDK_SRC;
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return sdkLoad;
}

/**
 * Why the in-tab player did not start: `account` (Spotify refused the
 * account, usually no Premium), `auth` (the grant lacks `streaming`),
 * `unavailable` (script blocked, unsupported browser, or no answer).
 */
export type SdkFailure = 'account' | 'auth' | 'unavailable';

export type SdkResult = { deviceId: string; failure: null } | { deviceId: null; failure: SdkFailure };

let player: SpotifyPlayerLike | null = null;
let sdkDevice: string | null = null;

/** Starts the in-tab player and resolves with its device id, or why it could not start. */
export async function ensureSdkDevice(volume: number): Promise<SdkResult> {
  if (sdkDevice) return { deviceId: sdkDevice, failure: null };
  const unavailable = { deviceId: null, failure: 'unavailable' } as const;
  try {
    await loadSdk();
    if (!window.Spotify) return unavailable;
    const p = new window.Spotify.Player({
      name: 'Vega board',
      volume,
      getOAuthToken: (cb) => {
        void accessToken().then((t) => t && cb(t));
      },
    });
    const ready = new Promise<SdkResult>((resolve) => {
      p.addListener('ready', ({ device_id }) => resolve(device_id ? { deviceId: device_id, failure: null } : unavailable));
      p.addListener('not_ready', () => resolve(unavailable));
      p.addListener('initialization_error', () => resolve(unavailable));
      p.addListener('authentication_error', () => resolve({ deviceId: null, failure: 'auth' }));
      p.addListener('account_error', () => resolve({ deviceId: null, failure: 'account' }));
      setTimeout(() => resolve(unavailable), 8000);
    });
    p.addListener('player_state_changed', (s) => stateListener?.(s));
    // Chrome requires activation inside the click that started playback.
    await p.activateElement?.();
    const ok = await p.connect();
    if (!ok) return unavailable;
    const result = await ready;
    if (!result.deviceId) {
      p.disconnect();
      return result;
    }
    player = p;
    sdkDevice = result.deviceId;
    return result;
  } catch {
    return unavailable;
  }
}

type StateListener = (state: unknown) => void;
let stateListener: StateListener | null = null;

/** Receives every state change of the in-tab player (track, position, pause, shuffle, repeat). One listener at a time. */
export function onSdkState(fn: StateListener | null): void {
  stateListener = fn;
}

export async function seekSdk(ms: number): Promise<boolean> {
  if (!player) return false;
  try {
    await player.seek(Math.max(0, Math.round(ms)));
    return true;
  } catch {
    return false;
  }
}

export async function skipSdk(direction: 1 | -1): Promise<boolean> {
  if (!player) return false;
  try {
    await (direction === 1 ? player.nextTrack() : player.previousTrack());
    return true;
  } catch {
    return false;
  }
}

export async function setSdkVolume(volume: number): Promise<void> {
  await player?.setVolume(volume).catch(() => {});
}

/** Pauses the in-tab player, wherever Spotify thinks the active device is. */
export async function pauseSdk(): Promise<boolean> {
  if (!player) return false;
  await player.pause().catch(() => {});
  return true;
}

/** Resumes the in-tab player where it stopped. False when there is no player or it refuses. */
export async function resumeSdk(): Promise<boolean> {
  if (!player) return false;
  try {
    await player.resume();
    return true;
  } catch {
    return false;
  }
}

export const hasSdkPlayer = (): boolean => player !== null;

export function teardownSdk(): void {
  player?.disconnect();
  player = null;
  sdkDevice = null;
}
