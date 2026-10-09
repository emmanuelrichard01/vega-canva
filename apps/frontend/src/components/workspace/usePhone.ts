import { useSyncExternalStore } from 'react';
import { getDevice, subscribeDevice, type DeviceClass } from '../../engine/ui/device';

const deviceClass = (): DeviceClass => getDevice().deviceClass;
const serverClass = (): DeviceClass => 'desktop';

/** The device class from `engine/ui/device`, re-rendering when it changes. */
export function useDeviceClass(): DeviceClass {
  return useSyncExternalStore(subscribeDevice, deviceClass, serverClass);
}

/** Whether the phone shell is in charge: a coarse pointer on a viewport under 600px. */
export function usePhone(): boolean {
  return useDeviceClass() === 'phone';
}
