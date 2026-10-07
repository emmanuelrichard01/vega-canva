import React, { useEffect, useRef } from 'react';
import { MusicButton } from '../music/MusicPlayer';
import { musicSlot } from './musicSlot';
import { hasSignInNotice, resumeSpotifyIntent } from '../../engine/music/spotify/auth';

/**
 * The record button beside your avatar, in the panel header and the pill.
 *
 * It is always present and costs almost nothing: the button reads only the
 * playing-state signal, and the player loads the first time it opens. The
 * board menu's Music item opens it by clicking this same trigger, so both
 * paths behave identically.
 */
const MusicHeaderSlot: React.FC = () => {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const openIfAsked = () => {
      if (!musicSlot.takeOpen()) return;
      const trigger = host.current?.querySelector<HTMLButtonElement>('button');
      if (trigger && trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    };
    openIfAsked();
    return musicSlot.subscribe(openIfAsked);
  }, []);

  // A hop from a loopback address lands here with the intent to connect; a sign-in that just returned opens the player to show how it went.
  useEffect(() => {
    void resumeSpotifyIntent().then(() => {
      if (hasSignInNotice()) musicSlot.request();
    });
  }, []);

  return (
    <span ref={host} className="hdr-music">
      <MusicButton />
    </span>
  );
};

export default MusicHeaderSlot;
