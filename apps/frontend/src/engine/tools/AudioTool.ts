import { nanoid } from 'nanoid';
import type { Tool, ToolContext } from './Tool';
import { localAuthor } from '../document';
import { presenceManager } from '../presence/PresenceManager';

/**
 * Hard stop for a single take.
 *
 * A voice note is a remark, not a podcast, and an unattended recording holds
 * the microphone open and accumulates sixty peak samples a second until the
 * tab closes. Reaching the cap *keeps* the take rather than discarding it —
 * the words were still said.
 */
const MAX_RECORDING_MS = 5 * 60 * 1000;

export class AudioTool implements Tool {
  id = 'audio';
  cursor = 'crosshair';

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private startTime: number = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  private animationFrameId: number | null = null;
  private waveformData: number[] = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private isRecording = false;
  /** World-space point captured when recording begins (see onPointerDown). */
  private dropPoint: { x: number; y: number } = { x: 0, y: 0 };
  /** Rolling recent levels, used to drive the live HUD meter. */
  private recentLevels: number[] = [];

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(new ArrayBuffer(bufferLength));
      this.waveformData = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100);
      this.startTime = Date.now();
      this.isRecording = true;
      presenceManager.updateActivity('recording');
      this.attachKeys(ctx);
      ctx.setOverlayState?.({ type: 'audio-recording' });
      // Lets Room.tsx's "click anywhere to record" hint get out of the way
      // once recording actually starts, instead of sitting there stale.
      window.dispatchEvent(new CustomEvent('audio-recording-start'));
      
      const recordWaveform = () => {
        if (!this.analyser || !this.dataArray || !this.isRecording) return;

        // A recording nobody stopped runs until the tab closes, holding the
        // microphone open and growing the peak array by 60 samples a second.
        // Stopping at the cap keeps what was said rather than discarding it.
        const elapsed = Date.now() - this.startTime;
        if (elapsed >= MAX_RECORDING_MS) {
          this.stopRecording(ctx);
          return;
        }

        this.analyser.getByteFrequencyData(this.dataArray);

        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
          sum += this.dataArray[i];
        }
        const average = sum / this.dataArray.length;
        const level = average / 255;
        this.waveformData.push(level);

        // Keep a short rolling window for the live meter so the HUD shows the
        // last ~2s of input rather than the whole take.
        this.recentLevels.push(level);
        if (this.recentLevels.length > 48) this.recentLevels.shift();

        // Push HUD state every frame. This is what makes recording visible at all —
        // the overlay state was previously set once and never rendered by anything.
        ctx.setOverlayState?.({
          type: 'audio-recording',
          elapsedMs: elapsed,
          remainingMs: MAX_RECORDING_MS - elapsed,
          level,
          levels: [...this.recentLevels],
          onCancel: () => this.cancelRecording(ctx),
        });

        this.animationFrameId = requestAnimationFrame(recordWaveform);
      };
      recordWaveform();

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
      const reason =
        (err as DOMException)?.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser’s site settings to record.'
          : (err as DOMException)?.name === 'NotFoundError'
            ? 'No microphone found. Connect one and try again.'
            : 'Could not start recording.';
      window.dispatchEvent(new CustomEvent('audio-recording-error', { detail: { message: reason } }));
    }
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
    this.isRecording = false;
    presenceManager.updateActivity(null);
    ctx.setOverlayState?.(null);
    window.dispatchEvent(new CustomEvent('audio-recording-stop'));
    this.recentLevels = [];
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

    // Drop the chunks before stopping, so `onstop` has nothing to build from.
    this.audioChunks = [];
    this.mediaRecorder.onstop = () => {
      this.mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
      this.audioContext?.close();
    };
    this.mediaRecorder.stop();
    this.detachKeys();
  }

  /** Escape discards, exactly as it does in every other mode in this app. */
  private attachKeys(ctx: ToolContext) {
    this.detachKeys();
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.cancelRecording(ctx);
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private detachKeys() {
    if (!this.keyHandler) return;
    window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
  }

  private stopRecording(ctx: ToolContext) {
    if (!this.mediaRecorder || !this.isRecording) return;
    this.isRecording = false;
    this.detachKeys();
    presenceManager.updateActivity(null);
    ctx.setOverlayState?.(null);
    window.dispatchEvent(new CustomEvent('audio-recording-stop'));
    this.recentLevels = [];
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

    this.mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      const durationMs = Date.now() - this.startTime;

      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = () => {
        const base64data = reader.result as string;

        const { x, y } = this.dropPoint;

        const targetPoints = 50;
        const step = Math.max(1, Math.floor(this.waveformData.length / targetPoints));
        const downsampledWaveform = [];
        for (let i = 0; i < this.waveformData.length; i += step) {
           downsampledWaveform.push(this.waveformData[i]);
        }

        ctx.editor.createNode({
          id: nanoid(),
          type: 'audio',
          x,
          y,
          width: 240,
          height: 64,
          src: base64data,
          durationMs,
          waveform: downsampledWaveform.slice(0, targetPoints),
          author: localAuthor(),
        });
        
        this.mediaRecorder?.stream.getTracks().forEach(track => track.stop());
        this.audioContext?.close();
      };
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
