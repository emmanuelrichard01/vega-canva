import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import { localAuthor, roomId } from '../document';
import { presenceManager } from '../presence/PresenceManager';
import { meterLevel, rmsLevel, isSilent } from '../model/audioLevel';
import { calculateOptimalAudioWidth, resampleWaveform } from '../model/audioPlayback';
import { localSrcFor, registerLocalMedia } from '../../utils/pendingMedia';
import { uploadMedia } from '../media/upload';
import { audioExtension, pickRecordingType, recordedAudioType, uploadAudioType } from '../media/audioFormat';
import {
  createTranscriber,
  setTranscriptionWanted,
  transcriptionSupported,
  transcriptionWanted,
  type Transcriber,
  type TranscriberError,
} from '../media/transcribe';

/**
 * Hard stop for a single take.
 *
 * A voice note is a remark, not a podcast, and an unattended recording holds
 * the microphone open and accumulates peaks until the tab closes. Reaching the
 * cap *keeps* the take rather than discarding it — the words were still said.
 */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/**
 * Peaks kept for the stored waveform.
 *
 * The player resamples this down to whatever fits its width, so this is the
 * resolution the *document* carries rather than the resolution anything draws.
 * 240 is enough for a five-minute note to still show its shape when the node is
 * stretched wide, and small enough that the array is a rounding error next to
 * the audio it describes.
 */
const STORED_PEAKS = 240;

/**
 * Bitrate for a voice note, in bits per second.
 *
 * ## Why this is set at all
 *
 * `new MediaRecorder(stream)` takes the browser's default, and Chrome's
 * default for Opus is around 128 kbps — a music setting. Speech carries
 * perfectly at a fraction of that. Audio recordings are piped out-of-band
 * directly to the server media proxy and object storage, keeping only a lightweight
 * URL reference in the CRDT document.
 *
 * 24 kbps mono Opus is above the rate most voice calls run at, preserving speech
 * clarity while minimizing bandwidth and storage overhead.
 */
const VOICE_BITRATE = 24_000;

/** The best container this browser can record. See `audioFormat.ts` for the order. */
function bestMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return pickRecordingType((type) => MediaRecorder.isTypeSupported(type));
}

/** How many recent levels the HUD's rolling meter shows. */
const METER_WINDOW = 48;

/**
 * How long a run of near-silence before the HUD says so, in samples.
 *
 * At roughly one sample per animation frame this is about two and a half
 * seconds — longer than a pause for breath, shorter than a wasted take.
 */
const SILENCE_RUN = 150;

export class AudioTool implements Tool {
  id = 'audio';
  cursor = 'crosshair';

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  private animationFrameId: number | null = null;
  private waveformData: number[] = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private isRecording = false;
  private isPaused = false;

  /**
   * Elapsed time, accumulated across pauses.
   *
   * `Date.now() - startTime` was the whole clock, which is correct only for a
   * take that was never paused. With pause it counts the time you spent
   * stopped — so a note paused for a minute claimed to be a minute longer than
   * its own audio, and the player's progress bar could never reach the end.
   */
  private elapsedBeforePause = 0;
  private runStartedAt = 0;

  /** World-space point captured when recording begins (see onPointerDown). */
  private dropPoint: { x: number; y: number } = { x: 0, y: 0 };
  /** Rolling recent levels, used to drive the live HUD meter. */
  private recentLevels: number[] = [];
  /** Long tail of levels, only for deciding whether anything is being heard. */
  private silenceWindow: number[] = [];

  /** The browser's speech recognition for this take, when the person turned it on. */
  private transcriber: Transcriber | null = null;
  private transcript = '';
  private transcriptError: TranscriberError | null = null;

  private elapsedMs(): number {
    return this.elapsedBeforePause + (this.isPaused ? 0 : Date.now() - this.runStartedAt);
  }

  async onPointerDown(ctx: ToolContext, e: any) {
    if (this.isRecording) {
      this.stopRecording(ctx);
      return;
    }

    // Capture the drop point at the moment recording STARTS, not when it stops.
    // Previously the position came from the stop-click, so if the user moved the
    // mouse while talking (which everyone does) the note landed somewhere random.
    const startStage = e.target?.getStage?.();
    const startPos = startStage?.getPointerPosition?.();
    if (startPos) {
      this.dropPoint = {
        x: (startPos.x - ctx.camera.x) / ctx.camera.zoom,
        y: (startPos.y - ctx.camera.y) / ctx.camera.zoom,
      };
    } else {
      this.dropPoint = { x: 0, y: 0 };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        /**
         * Asked for explicitly rather than taking the browser's defaults.
         *
         * A voice note is one person talking into a laptop in a room with other
         * people in it, which is precisely the case these three were built for.
         * Left unset, Chrome applies them and Safari does not, so the same note
         * recorded on two machines sounded like two different features.
         */
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = bestMimeType();
      this.mediaRecorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: VOICE_BITRATE,
      });
      this.audioChunks = [];

      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      /**
       * Konva-style smoothing is wrong for a level meter: it is the analyser's
       * own averaging over previous frames, which makes a meter lag the voice
       * it is showing. The point of this meter is to react *now*.
       */
      this.analyser.smoothingTimeConstant = 0;
      source.connect(this.analyser);
      // Time domain, not frequency: `fftSize` samples rather than half as many
      // bins. See `audioLevel` for why the measurement changed.
      this.dataArray = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.waveformData = [];
      this.recentLevels = [];
      this.silenceWindow = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // No timeslice. Sliced recording gains nothing here (the take is only
      // used whole) and costs a WebM with no duration in its header and, on
      // some Safari builds, MP4 fragments that do not reassemble into a file
      // that plays.
      this.mediaRecorder.start();
      this.elapsedBeforePause = 0;
      this.runStartedAt = Date.now();
      this.isRecording = true;
      this.isPaused = false;
      presenceManager.updateActivity('recording');
      this.attachKeys(ctx);
      this.transcript = '';
      this.transcriptError = null;
      if (transcriptionWanted()) this.startTranscription();
      // Lets Room.tsx's "click anywhere to record" hint get out of the way
      // once recording actually starts, instead of sitting there stale.
      window.dispatchEvent(new CustomEvent('audio-recording-start'));

      const sample = () => {
        if (!this.analyser || !this.dataArray || !this.isRecording) return;

        const elapsed = this.elapsedMs();

        // A recording nobody stopped runs until the tab closes, holding the
        // microphone open. Stopping at the cap keeps what was said rather than
        // discarding it.
        if (elapsed >= MAX_RECORDING_MS) {
          this.stopRecording(ctx);
          return;
        }

        // While paused the meter still runs, but nothing is *recorded* — so the
        // waveform must not grow, or the stored shape would carry a long flat
        // stretch that no audio corresponds to.
        if (!this.isPaused) {
          this.analyser.getByteTimeDomainData(this.dataArray);
          const level = meterLevel(rmsLevel(this.dataArray));
          this.waveformData.push(level);

          this.recentLevels.push(level);
          if (this.recentLevels.length > METER_WINDOW) this.recentLevels.shift();

          this.silenceWindow.push(level);
          if (this.silenceWindow.length > SILENCE_RUN) this.silenceWindow.shift();
        }

        this.pushHud(ctx, elapsed);
        this.animationFrameId = requestAnimationFrame(sample);
      };
      sample();

    } catch (err) {
      /**
       * A denied or missing microphone used to `console.error` and stop.
       *
       * From the user's side that is: pick the tool, click the canvas, and
       * nothing whatsoever happens — no note, no message, no hint that the
       * browser is holding a permission prompt or that it was refused three
       * months ago and is now auto-denying. Silence is the worst possible
       * response to the one failure this feature has.
       */
      this.isRecording = false;
      ctx.setOverlayState?.(null);
      const name = (err as DOMException)?.name;
      const reason =
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser’s site settings to record.'
          : name === 'NotFoundError'
            ? 'No microphone found. Connect one and try again.'
            : name === 'NotReadableError'
              ? 'Your microphone is in use by another app. Close it and try again.'
              : 'Could not start recording.';
      window.dispatchEvent(new CustomEvent('audio-recording-error', { detail: { message: reason } }));
    }
  }

  /**
   * Begin hearing words, from this moment in the take.
   *
   * Turned on mid-take it transcribes from then on; what was said before is
   * not recoverable, and the caption makes that visible by starting empty.
   */
  private startTranscription() {
    this.transcriber?.cancel();
    this.transcriptError = null;
    this.transcriber = createTranscriber((text, error) => {
      this.transcript = text;
      if (error) {
        this.transcriptError = error;
        this.transcriber = null;
        // A browser that refused once refuses every time; the next take does
        // not open by asking again and failing again.
        if (error === 'blocked') setTranscriptionWanted(false);
      }
    });
    if (!this.transcriber) {
      this.transcriptError = 'unavailable';
      return;
    }
    if (!this.isPaused) this.transcriber.start();
  }

  private toggleTranscription(ctx: ToolContext) {
    if (!this.isRecording || !transcriptionSupported()) return;
    if (this.transcriber) {
      // Off means off: what it heard so far is dropped, not kept quietly.
      this.transcriber.cancel();
      this.transcriber = null;
      this.transcript = '';
      setTranscriptionWanted(false);
    } else {
      setTranscriptionWanted(true);
      this.startTranscription();
    }
    this.pushHud(ctx, this.elapsedMs());
  }

  private pushHud(ctx: ToolContext, elapsed: number) {
    ctx.setOverlayState?.({
      type: 'audio-recording',
      elapsedMs: elapsed,
      maxMs: MAX_RECORDING_MS,
      remainingMs: MAX_RECORDING_MS - elapsed,
      transcription: {
        supported: transcriptionSupported(),
        on: this.transcriber !== null,
        text: this.transcript,
        error: this.transcriptError,
      },
      onToggleTranscription: () => this.toggleTranscription(ctx),
      levels: [...this.recentLevels],
      paused: this.isPaused,
      // Only claimed once there is a full window to judge, so a take does not
      // open by accusing the microphone of being silent before it has heard
      // anything at all.
      silent:
        !this.isPaused &&
        this.silenceWindow.length >= SILENCE_RUN &&
        isSilent(this.silenceWindow),
      onCancel: () => this.cancelRecording(ctx),
      onTogglePause: () => this.togglePause(ctx),
    });
  }

  /**
   * Pause and resume, which is the thing a one-take recorder is missing.
   *
   * Someone interrupts, a door goes, you lose the thread — without this the
   * only options are to keep talking through it or throw the take away and
   * start again. `MediaRecorder.pause()` stops the stream cleanly, so the
   * resulting file has no gap in it and the clock has to skip the same
   * interval; that is what `elapsedBeforePause` is for.
   */
  private togglePause(ctx: ToolContext) {
    if (!this.mediaRecorder || !this.isRecording) return;

    if (this.isPaused) {
      this.mediaRecorder.resume();
      this.runStartedAt = Date.now();
      this.isPaused = false;
      this.transcriber?.start();
      presenceManager.updateActivity('recording');
      // Cleared so a pause is not immediately followed by a silence warning
      // built out of samples from before it.
      this.silenceWindow = [];
    } else {
      this.mediaRecorder.pause();
      this.elapsedBeforePause += Date.now() - this.runStartedAt;
      this.isPaused = true;
      this.transcriber?.pause();
      presenceManager.updateActivity(null);
    }
    this.pushHud(ctx, this.elapsedMs());
  }

  /**
   * Throw the take away.
   *
   * Stop was the only exit, and it *keeps* the recording — so a false start, a
   * cough, or realising the mic caught nothing meant placing a note on the
   * board and then hunting it down to delete it. Every recorder has a discard.
   */
  private cancelRecording(ctx: ToolContext) {
    if (!this.mediaRecorder || !this.isRecording) return;
    this.teardown(ctx);
    this.transcriber?.cancel();
    this.transcriber = null;
    this.transcript = '';

    // Drop the chunks before stopping, so `onstop` has nothing to build from.
    this.audioChunks = [];
    this.mediaRecorder.onstop = () => this.releaseHardware();
    this.mediaRecorder.stop();
  }

  /** Escape discards, exactly as it does in every other mode in this app. */
  private attachKeys(ctx: ToolContext) {
    this.detachKeys();
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelRecording(ctx);
        return;
      }
      // Space pauses, the way it does in every transport control anywhere —
      // and the recording HUD is the only thing on screen at the time, so
      // there is nothing for it to conflict with.
      const onControl = e.target instanceof HTMLElement && !!e.target.closest('button, input, textarea, [contenteditable]');
      // Enter keeps the take — unless a focused control already owns the key.
      if (e.key === 'Enter' && this.isRecording && !onControl) {
        e.preventDefault();
        this.stopRecording(ctx);
        return;
      }
      if (e.key === ' ' && this.isRecording) {
        e.preventDefault();
        this.togglePause(ctx);
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private detachKeys() {
    if (!this.keyHandler) return;
    window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
  }

  /** The bookkeeping every ending shares, whether it keeps the take or not. */
  private teardown(ctx: ToolContext) {
    this.isRecording = false;
    this.isPaused = false;
    this.detachKeys();
    presenceManager.updateActivity(null);
    ctx.setOverlayState?.(null);
    window.dispatchEvent(new CustomEvent('audio-recording-stop'));
    this.recentLevels = [];
    this.silenceWindow = [];
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  /**
   * Let go of the microphone and the audio graph.
   *
   * Both halves matter: leaving the tracks live keeps the browser's recording
   * indicator lit and the microphone held against other apps, and leaving the
   * `AudioContext` open leaks one per take — browsers cap how many a page may
   * have, so enough voice notes and no further one can start.
   */
  private releaseHardware() {
    this.mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
    this.audioContext?.close();
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
  }

  private stopRecording(ctx: ToolContext) {
    if (!this.mediaRecorder || !this.isRecording) return;
    const durationMs = this.elapsedMs();
    const peaks = this.waveformData;
    const transcript = this.transcriber ? this.transcriber.finish() : this.transcript;
    this.transcriber = null;
    this.transcript = '';
    this.teardown(ctx);

    const recorder = this.mediaRecorder;
    recorder.onstop = () => {
      // The microphone is let go first: the take is complete, and the upload
      // that follows must not keep the browser's recording indicator lit.
      this.releaseHardware();
      const chunks = this.audioChunks;
      this.audioChunks = [];
      const recordedType = recordedAudioType(recorder.mimeType, chunks);
      const audioBlob = new Blob(chunks, { type: recordedType });

      // A take with no bytes cannot be played by anyone, so it is not placed.
      if (audioBlob.size === 0) {
        window.dispatchEvent(
          new CustomEvent('audio-recording-error', {
            detail: { message: 'Nothing was recorded. Check your microphone and try again.' },
          })
        );
        return;
      }

      const { x, y } = this.dropPoint;
      const objId = nanoid();
      // One id for the pending upload: the queue's key and the `local:` src
      // the document carries. See `pendingMedia.ts` for why a blob URL must
      // not go into a shared document.
      const uploadId = nanoid();
      registerLocalMedia(uploadId, audioBlob);
      const author = localAuthor();

      // Placed at once and playable at once, from the bytes on this device.
      // `uploadMedia` swaps in the stored URL when the server has it, keeps
      // the bytes for Retry when the server refuses, and queues them when the
      // network is down.
      ctx.editor.createNode({
        id: objId,
        type: 'audio',
        x,
        y,
        width: calculateOptimalAudioWidth(author.name, durationMs),
        height: 64,
        src: localSrcFor(uploadId),
        durationMs,
        waveform: resampleWaveform(peaks, STORED_PEAKS),
        author,
        ...(transcript ? { transcript } : {}),
      });

      const file = new File([audioBlob], `voice-note.${audioExtension(recordedType)}`, {
        type: uploadAudioType(recordedType),
      });
      void uploadMedia({ uploadId, objectId: objId, roomId, file, mediaType: 'audio' });
    };

    this.mediaRecorder.stop();
  }

  onPointerMove() {}
  onPointerUp() {}

  // Switching tools mid-recording (clicking Select, pressing a shortcut, ...)
  // previously left the MediaRecorder and mic stream running forever with no
  // way to stop it — a live, uncapturable microphone leak until the tab
  // closed. Finalize and save the note instead, same as an explicit stop-click.
  onDeactivate(ctx: ToolContext) {
    if (this.isRecording) {
      this.stopRecording(ctx);
    }
  }
}
