/**
 * Where Spotify audio plays, in order of preference:
 *
 * 1. In this tab, through the Web Playback SDK (Spotify Premium only). The SDK
 *    script loads from sdk.scdn.co only when someone first plays.
 * 2. On one of the person's own Spotify devices, through the Connect API.
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
}): PlaybackRoute {
  if (opts.premium && opts.sdkDeviceId) return { kind: 'sdk' };
  const device = opts.devices.find((d) => d.isActive) ?? opts.devices[0];
  if (device) return { kind: 'device', deviceId: device.id, name: device.name };
  return { kind: 'embed' };
}

interface SpotifyPlayerLike {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (arg: { device_id?: string; message?: string }) => void): void;
  setVolume(v: number): Promise<void>;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  activateElement?(): Promise<void>;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: { Player: new (opts: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume?: number }) => SpotifyPlayerLike };
  }
}

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';
let sdkLoad: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkLoad ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onerror = () => {
      sdkLoad = null;
      reject(new Error('The Spotify player could not load.'));
    };
    document.head.appendChild(script);
  });
  return sdkLoad;
}

let player: SpotifyPlayerLike | null = null;
let sdkDevice: string | null = null;

/**
 * Starts the in-tab player and resolves with its device id, or null when the
 * SDK cannot run here (no Premium, a blocked script, an unsupported browser).
 */
export async function ensureSdkDevice(volume: number): Promise<string | null> {
  if (sdkDevice) return sdkDevice;
  try {
    await loadSdk();
    if (!window.Spotify) return null;
    const p = new window.Spotify.Player({
      name: 'Vega board',
      volume,
      getOAuthToken: (cb) => {
        void accessToken().then((t) => t && cb(t));
      },
    });
    const ready = new Promise<string | null>((resolve) => {
      p.addListener('ready', ({ device_id }) => resolve(device_id ?? null));
      p.addListener('not_ready', () => resolve(null));
      for (const e of ['initialization_error', 'authentication_error', 'account_error']) p.addListener(e, () => resolve(null));
      setTimeout(() => resolve(null), 8000);
    });
    // Chrome requires activation inside the click that started playback.
    await p.activateElement?.();
    const ok = await p.connect();
    if (!ok) return null;
    const id = await ready;
    if (!id) {
      p.disconnect();
      return null;
    }
    player = p;
    sdkDevice = id;
    return id;
  } catch {
    return null;
  }
}

export async function setSdkVolume(volume: number): Promise<void> {
  await player?.setVolume(volume).catch(() => {});
}

export function teardownSdk(): void {
  player?.disconnect();
  player = null;
  sdkDevice = null;
}
