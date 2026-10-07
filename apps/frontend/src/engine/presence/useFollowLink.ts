import { useEffect } from 'react';
import { collaboratorStore } from './collaboratorStore';
import { followMode } from './followMode';
import {
  FOLLOW_WAIT_MS,
  readFollowTarget,
  resolveFollowTarget,
  withoutFollowParam,
} from './followLink';

/**
 * Honour `?follow=` once: attach to that person when they are in the room.
 *
 * The parameter is removed from the address straight away, so copying the
 * address bar later does not hand somebody else a follow they never asked for,
 * and a reload does not re-attach a camera the visitor has since taken back.
 */
let claimed: { target: string | null } | null = null;

/** Read the parameter once per page load, however many times the effect runs. */
function claimTarget(): string | null {
  if (!claimed) {
    const target = readFollowTarget(window.location.search);
    claimed = { target };
    if (target) {
      const { pathname, hash, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${withoutFollowParam(search)}${hash}`);
    }
  }
  return claimed.target;
}

export function useFollowLink(): void {
  useEffect(() => {
    const target = claimTarget();
    if (!target) return;

    let done = false;
    const detach = () => {
      done = true;
      off();
      window.clearTimeout(timer);
    };
    const finish = () => {
      if (claimed) claimed.target = null;
      detach();
    };
    const attempt = () => {
      if (done) return;
      const clientId = resolveFollowTarget(collaboratorStore.getSnapshot(), target);
      if (clientId === null) return;
      followMode.start(clientId);
      finish();
    };
    const off = collaboratorStore.subscribe(attempt);
    const timer = window.setTimeout(finish, FOLLOW_WAIT_MS);
    attempt();
    return detach;
  }, []);
}
