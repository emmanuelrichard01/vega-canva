import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockIsRecording = false;
let mockMicError: string | null = null;
const setIsRecording = vi.fn((val) => {
  mockIsRecording = typeof val === 'function' ? val(mockIsRecording) : val;
});
const setMicError = vi.fn((val) => {
  mockMicError = typeof val === 'function' ? val(mockMicError) : val;
});

vi.mock('react', () => {
  return {
    default: {
      useState: (init: any) => [
        init,
        (val: any) => {
          if (typeof init === 'boolean') setIsRecording(val);
          else setMicError(val);
        },
      ],
      useRef: (init: any) => ({ current: init }),
      useEffect: (fn: () => any) => {
        const cleanup = fn?.();
        return cleanup;
      },
    },
    useState: (init: any) => [
      init,
      (val: any) => {
        if (typeof init === 'boolean') setIsRecording(val);
        else setMicError(val);
      },
    ],
    useRef: (init: any) => ({ current: init }),
    useEffect: (fn: () => any) => {
      const cleanup = fn?.();
      return cleanup;
    },
  };
});

import { useCanvasAudioRecording } from './useCanvasAudioRecording';

describe('useCanvasAudioRecording', () => {
  let listeners: Record<string, ((e: any) => void)[]> = {};

  beforeEach(() => {
    listeners = {};
    setIsRecording.mockClear();
    setMicError.mockClear();

    const mockWindow = {
      addEventListener: vi.fn((event: string, cb: (e: any) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      }),
      removeEventListener: vi.fn((event: string, cb: (e: any) => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((fn) => fn !== cb);
        }
      }),
      dispatchEvent: vi.fn((event: any) => {
        const cbs = listeners[event.type] || [];
        cbs.forEach((cb) => cb(event));
        return true;
      }),
    };
    (globalThis as any).window = mockWindow;
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('calls onStop callback when audio-recording-stop event fires', () => {
    const onStop = vi.fn();
    useCanvasAudioRecording({ onStop });

    window.dispatchEvent({ type: 'audio-recording-stop' } as any);
    expect(setIsRecording).toHaveBeenCalledWith(false);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('calls onError callback when audio-recording-error event fires', () => {
    const onError = vi.fn();
    useCanvasAudioRecording({ onError });

    window.dispatchEvent({
      type: 'audio-recording-error',
      detail: { message: 'Microphone permission denied' },
    } as any);
    expect(setIsRecording).toHaveBeenCalledWith(false);
    expect(setMicError).toHaveBeenCalledWith('Microphone permission denied');
    expect(onError).toHaveBeenCalledWith('Microphone permission denied');
  });

  it('sets isRecording to true and clears error on audio-recording-start', () => {
    useCanvasAudioRecording();

    window.dispatchEvent({ type: 'audio-recording-start' } as any);
    expect(setIsRecording).toHaveBeenCalledWith(true);
    expect(setMicError).toHaveBeenCalledWith(null);
  });
});
