import { useState, useEffect } from 'react';

/**
 * Manages audio recording lifecycle and error telemetry from AudioTool events.
 */
export function useCanvasAudioRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  useEffect(() => {
    const onStart = () => {
      setIsRecording(true);
      setMicError(null);
    };
    const onStop = () => setIsRecording(false);
    const onError = (e: Event) => {
      setIsRecording(false);
      setMicError((e as CustomEvent<{ message: string }>).detail?.message ?? null);
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
