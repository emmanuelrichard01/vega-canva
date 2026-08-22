import { useState, useEffect, useRef } from 'react';

export interface UseCanvasAudioRecordingOptions {
  onStop?: () => void;
  onError?: (message: string | null) => void;
}

/**
 * Manages audio recording lifecycle and error telemetry from AudioTool events.
 */
export function useCanvasAudioRecording(options?: UseCanvasAudioRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const onStart = () => {
      setIsRecording(true);
      setMicError(null);
    };
    const onStop = () => {
      setIsRecording(false);
      optionsRef.current?.onStop?.();
    };
    const onError = (e: Event) => {
      setIsRecording(false);
      const msg = (e as CustomEvent<{ message: string }>).detail?.message ?? null;
      setMicError(msg);
      optionsRef.current?.onError?.(msg);
    };

    window.addEventListener('audio-recording-start', onStart);
    window.addEventListener('audio-recording-stop', onStop);
    window.addEventListener('audio-recording-error', onError);

    return () => {
      window.removeEventListener('audio-recording-start', onStart);
      window.removeEventListener('audio-recording-stop', onStop);
      window.removeEventListener('audio-recording-error', onError);
    };
  }, []);

  return { isRecording, micError, setMicError };
}
