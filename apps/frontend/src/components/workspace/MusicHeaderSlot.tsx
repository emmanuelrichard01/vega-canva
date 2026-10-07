import React, { useEffect, useRef } from 'react';
import { MusicButton } from '../music/MusicPlayer';
import { musicSlot } from './musicSlot';

/**
 * The player's button in the header, loaded on first request.
 *
 * Opening it is a click on its own trigger: the button owns its panel's
 * state, and a request from the board menu should behave exactly as if the
 * button had been pressed.
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

  return (
    <span ref={host} className="hdr-music">
      <MusicButton />
    </span>
  );
};

export default MusicHeaderSlot;
