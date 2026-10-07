import { useSyncExternalStore } from 'react';
import { engineEvents } from './EventBus';
import { cameraSystem } from './CameraSystem';

const subscribe = (onChange: () => void) => engineEvents.on('CameraChanged', onChange);
const getZoom = () => cameraSystem.zoom;

/**
 * The camera's zoom, re-rendering only the caller when it changes.
 *
 * For the few things drawn at a constant on-screen size — hairlines, handles,
 * frame titles. Reading `cameraSystem.zoom` during render instead goes stale on
 * a pure zoom, and passing it down as a prop re-renders everything between.
 */
export function useCameraZoom(): number {
  return useSyncExternalStore(subscribe, getZoom, getZoom);
}
