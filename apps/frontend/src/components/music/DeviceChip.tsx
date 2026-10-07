import React, { useCallback, useId, useRef, useState } from 'react';
import { Check, Laptop, Monitor, Smartphone, Speaker } from 'lucide-react';
import { chooseDevice, refreshSpotifyDevices, useSpotify } from '../../engine/music/spotify/spotifyStore';
import type { SpotifyDevice } from '../../engine/music/spotify/api';
import { useDismiss } from './hooks';

/** The in-tab player's name in Spotify's own list is plumbing; people know it as this board. */
const IN_TAB_NAME = 'Vega board';
export const deviceLabel = (name: string): string => (name === IN_TAB_NAME ? 'This board' : name);

const iconFor = (type: string) => (type === 'Smartphone' || type === 'Tablet' ? Smartphone : type === 'Speaker' || type === 'CastAudio' ? Speaker : type === 'Computer' ? Laptop : Monitor);

/**
 * "Playing on <device>": says where the sound comes from and, with Premium,
 * lists the person's open Spotify devices to move it to.
 */
export const DeviceChip: React.FC<{ volume: number }> = ({ volume }) => {
  const spotify = useSpotify();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, root, close);

  const route = spotify.route;
  if (!route || route.kind === 'embed') return null;
  const premium = spotify.profile?.product === 'premium';
  const here = route.kind === 'sdk' ? 'This board' : deviceLabel(route.name);
  const activeId = route.kind === 'device' ? route.deviceId : null;
  const Icon = route.kind === 'sdk' ? Laptop : iconFor(spotify.devices.find((d) => d.id === activeId)?.type ?? '');

  if (!premium) {
    return (
      <span className="music-device-chip is-static">
        <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
        <span className="music-device-chip__name">Playing on {here}</span>
      </span>
    );
  }

  const pick = (d: SpotifyDevice) => {
    setOpen(false);
    if (d.id !== activeId) void chooseDevice(d, volume);
  };

  return (
    <div className="music-device-wrap" ref={root}>
      <button
        type="button"
        className="music-device-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!open) void refreshSpotifyDevices();
          setOpen((v) => !v);
        }}
      >
        <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
        <span className="music-device-chip__name">Playing on {here}</span>
      </button>
      {open && (
        <div id={menuId} className="music-menu music-menu--up" role="menu" aria-label="Play on">
          {spotify.devices.length === 0 && <p className="music-menu__empty">Open Spotify on another device and it appears here.</p>}
          {spotify.devices.map((d) => {
            const DeviceIcon = iconFor(d.type);
            const selected = d.id === activeId || (route.kind === 'sdk' && d.name === IN_TAB_NAME);
            return (
              <button key={d.id} type="button" role="menuitemradio" aria-checked={selected} className="music-menu__item" onClick={() => pick(d)}>
                <DeviceIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                <span className="music-menu__label">{deviceLabel(d.name)}</span>
                {selected && <Check size={14} strokeWidth={2} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
