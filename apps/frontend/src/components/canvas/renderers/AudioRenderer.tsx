import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rect } from 'react-konva';
import { Html } from 'react-konva-utils';
import { Download, Pause, Play, TriangleAlert } from 'lucide-react';
import type { AudioNode } from '../../../engine/model/schema';
import { updateNode } from '../../../engine/document';
import {
  barCountFor,
  clamp01,
  formatAuthorShortName,
  formatClock,
  fractionFromPointer,
  keyboardSeek,
  normalizeWaveform,
  resampleWaveform,
  resolveDurationMs,
} from '../../../engine/model/audioPlayback';

interface Props {
  node: AudioNode;
}

/** Cycled by the speed control. Slower than 1× is absent by design. */
const SPEEDS = [1, 1.5, 2] as const;

/**
 * Only one voice note plays at a time.
 *
 * Two players talking over each other with no way to tell which to silence is
 * not a canvas-specific problem and does not get a canvas-specific answer.
 * It also means at most one frame loop is ever running for playback.
 */
let nowPlaying: HTMLAudioElement | null = null;

/**
 * Voice note player.
 *
 * A DOM overlay rather than Konva shapes, because it needs real audio
 * controls. Two consequences that are easy to lose and hard to diagnose:
 *
 * - **The node needs a `Rect` with a fill underneath it**, purely so it exists
 *   in Konva's hit graph. Without one the note cannot be selected or dragged,
 *   because both gestures resolve through that graph and this renderer draws
 *   no Konva shapes at all.
 * - **The card is `pointer-events: none`** and only its controls opt back in,
 *   so a press on the background falls through to the canvas and reaches the
 *   rect. With `auto` on the card, the overlay ate every event first.
 *
 * ## Why progress is a clip and not coloured bars
 *
 * Filling whole bars as the playhead passes them means the display only
 * changes once per bar — about once a second on a 35-bar waveform — so
 * playback looked frozen between steps. Worse, it was driven by `timeupdate`,
 * which fires roughly four times a second.
 *
 * The played portion is now a second copy of the waveform in the accent
 * colour, absolutely positioned over the first and revealed with `clip-path`.
 * Both layers occupy the same box and lay out identically, so the bars line up
 * by construction rather than by arithmetic, and the reveal edge moves
 * continuously and sub-pixel. A frame loop advances it while playing — which
 * costs one loop for the whole board, because only one note can play.
 */
export const AudioRenderer: React.FC<Props> = React.memo(({ node }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * Listeners are wired from a **ref callback**, not an effect.
   *
   * `Html` from react-konva-utils mounts its children into a container it
   * creates itself, which happens *after* this component's effects run — so an
   * effect reading `audioRef.current` finds `null`, bails, and (with stable
   * deps) never runs again. Nothing was ever bound to the element: no
   * duration, no position, no progress. The previous version only appeared to
   * work because its dependency array changed on interaction, giving it a
   * second chance by luck.
   *
   * A ref callback fires exactly when the element exists.
   */
  const detachRef = useRef<(() => void) | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [elementSeconds, setElementSeconds] = useState<number | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  // Read inside a listener bound once, where the state value would be stale.
  const scrubbingRef = useRef(false);
  scrubbingRef.current = scrubbing;
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const [speedIndex, setSpeedIndex] = useState(0);

  const speed = SPEEDS[speedIndex];
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const durationMs = resolveDurationMs(node.durationMs, elementSeconds);
  const durationSeconds = durationMs / 1000;
  const progress = durationSeconds > 0 ? clamp01(currentSeconds / durationSeconds) : 0;

  const bars = useMemo(
    () => normalizeWaveform(resampleWaveform(node.waveform, barCountFor(node.width))),
    [node.waveform, node.width]
  );

  /**
   * Advance the playhead every frame while playing.
   *
   * `timeupdate` alone is a ~4Hz signal, which on a progress bar reads as a
   * stutter rather than motion. The loop exists only while this note is
   * actually playing, and only one note can be, so the board never runs more
   * than one of these.
   */
  useEffect(() => {
    if (!isPlaying || scrubbing) return;
    const tick = () => {
      const el = audioRef.current;
      if (el) setCurrentSeconds(el.currentTime);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [isPlaying, scrubbing]);

  /**
   * Bind to the element once, and read what it already knows.
   *
   * Two bugs lived here. **Metadata can arrive before React attaches the
   * listener** — a `data:` URI or a cached file is ready essentially
   * immediately — so waiting only for `loadedmetadata` meant the duration was
   * never learned at all, the clock read `0:00 / 0:00`, and progress divided
   * by a zero duration and never moved. Reading `el.duration` on attach covers
   * the event that already happened.
   *
   * And the `play`/`pause`/`error` handlers were inline arrows that the
   * cleanup never removed, so every re-run of this effect stacked another set.
   */
  const attachAudio = useCallback((el: HTMLAudioElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    audioRef.current = el;
    if (!el) return;

    const readMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setElementSeconds(el.duration);
    };
    // `timeupdate` is the baseline: roughly 4Hz, but it keeps running when the
    // frame loop cannot — a backgrounded tab, or reduced-motion. The frame
    // loop smooths on top of it rather than replacing it, so playback is never
    // *only* as live as `requestAnimationFrame` happens to be.
    const onTime = () => {
      if (!scrubbingRef.current) setCurrentSeconds(el.currentTime);
    };
    const onEnd = () => {
      setIsPlaying(false);
      setCurrentSeconds(0);
      el.currentTime = 0;
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      setFailed(true);
      setIsPlaying(false);
    };

    readMeta();
    el.playbackRate = speedRef.current;
    el.addEventListener('loadedmetadata', readMeta);
    el.addEventListener('durationchange', readMeta);
    el.addEventListener('canplay', readMeta);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('error', onError);

    detachRef.current = () => {
      el.removeEventListener('loadedmetadata', readMeta);
      el.removeEventListener('durationchange', readMeta);
      el.removeEventListener('canplay', readMeta);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('error', onError);
    };
  }, []);

  /**
   * Backfill a duration the document never recorded. Uploaded clips are
   * created with `durationMs: 0`, so everything downstream had nothing to work
   * with — the clock read `0:00 / 0:00` while the clip audibly played.
   */
  useEffect(() => {
    if (node.durationMs > 0) return;
    if (!Number.isFinite(elementSeconds) || !((elementSeconds as number) > 0)) return;
    updateNode(node.id, { durationMs: Math.round((elementSeconds as number) * 1000) });
  }, [elementSeconds, node.durationMs, node.id]);

  // When `node.src` updates (e.g. upload finishes or offline sync resolves), clear failed state
  useEffect(() => {
    setFailed(false);
  }, [node.src]);

  // A fresh `src` resets `playbackRate`, so this is re-applied on both.
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed, node.src]);

  // Leaving the board mid-sentence should not keep talking.
  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (nowPlaying === el) nowPlaying = null;
      el?.pause();
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || failed) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (nowPlaying && nowPlaying !== el) nowPlaying.pause();
    nowPlaying = el;
    el.play().catch(() => {
      setFailed(true);
      setIsPlaying(false);
    });
  }, [failed]);

  /**
   * Save the recording to disk.
   *
   * The extension is read from the data URL's own media type rather than
   * assumed: this app records WebM on Chrome and MP4 on Safari, and a file
   * named `.webm` that holds MP4 bytes is one the operating system will refuse
   * to open.
   */
  const saveNote = useCallback(() => {
    if (!node.src) return;
    const declared = node.src.slice(5, node.src.indexOf(';'));
    const ext = declared.includes('mp4') ? 'm4a' : declared.includes('ogg') ? 'ogg' : 'webm';
    const stamp = new Date(node.createdAt ?? Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const link = document.createElement('a');
    link.href = node.src;
    link.download = `voice-note-${stamp}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [node.src, node.createdAt]);

  const seekTo = useCallback(
    (fraction: number) => {
      const el = audioRef.current;
      if (!el || !(durationSeconds > 0)) return;
      const time = fraction * durationSeconds;
      setCurrentSeconds(time);
      if (Number.isFinite(time)) el.currentTime = time;
    },
    [durationSeconds]
  );

  const fractionAt = useCallback((clientX: number) => {
    const rect = waveRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return fractionFromPointer(clientX, rect.left, rect.width);
  }, []);

  const seekable = durationSeconds > 0 && !failed;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!seekable) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    seekTo(fractionAt(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!seekable) return;
    const fraction = fractionAt(e.clientX);
    setHoverFraction(fraction);
    if (!scrubbing) return;
    e.stopPropagation();
    seekTo(fraction);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!scrubbing) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setScrubbing(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      togglePlay();
      return;
    }
    const next = keyboardSeek(e.key, currentSeconds, durationSeconds);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    seekTo(durationSeconds > 0 ? next / durationSeconds : 0);
  };

  // Percent of the track height, so a full-amplitude peak fills it. The floor
  // keeps a visible thread through silence rather than the trace disappearing.
  const waveBars = bars.map((value, i) => (
    <span key={i} className="vn-bar" style={{ height: `${Math.max(14, value * 100)}%` }} />
  ));

  return (
    <>
      {/* The node's hit area. See the note at the top: without a filled shape
          here, a voice note cannot be selected or dragged. */}
      <Rect width={node.width} height={node.height} cornerRadius={16} fill="transparent" />

      <Html divProps={{ style: { pointerEvents: 'none' } }}>
        <div
          className="vn"
          data-playing={isPlaying || undefined}
          style={{ width: node.width, ['--vn-accent' as string]: node.author.color }}
        >
          {node.src && <audio ref={attachAudio} src={node.src} preload="metadata" />}

          <button
            type="button"
            className="vn-play"
            onClick={togglePlay}
            disabled={failed}
            aria-label={failed ? 'Recording unavailable' : isPlaying ? 'Pause' : 'Play'}
          >
            {failed ? (
              <TriangleAlert size={15} />
            ) : isPlaying ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" className="vn-play-glyph" />
            )}
          </button>

          <div className="vn-body">
            <div className="vn-top">
              <span className="vn-author" title={node.author.name || 'Anonymous'}>
                <span className="vn-who" style={{ background: node.author.color }} aria-hidden="true" />
                <span className="vn-name">{formatAuthorShortName(node.author.name)}</span>
              </span>
              <span className="vn-time">
                {formatClock(currentSeconds * 1000)}
                <span className="vn-total"> / {formatClock(durationMs)}</span>
              </span>
            </div>

            {failed ? (
              <span className="vn-error">Couldn’t load this recording</span>
            ) : (
              <div
                ref={waveRef}
                className="vn-wave"
                role="slider"
                tabIndex={0}
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.round(durationSeconds)}
                aria-valuenow={Math.round(currentSeconds)}
                aria-valuetext={`${formatClock(currentSeconds * 1000)} of ${formatClock(durationMs)}`}
                data-scrubbing={scrubbing || undefined}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={() => setHoverFraction(null)}
                onKeyDown={onKeyDown}
              >
                <div className="vn-layer" aria-hidden="true">
                  {waveBars}
                </div>

                {/* The same waveform again, in the accent, revealed by a clip.
                    Identical box, identical layout — the bars align by
                    construction, and the edge moves continuously. */}
                <div
                  className="vn-layer vn-played"
                  aria-hidden="true"
                  style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
                >
                  {waveBars}
                </div>

                {/* Where a click would land. Answering "what am I about to do"
                    before the click is most of what makes a scrubber feel
                    precise rather than approximate. */}
                {hoverFraction !== null && !scrubbing && (
                  <span
                    className="vn-hover"
                    aria-hidden="true"
                    style={{ left: `${hoverFraction * 100}%` }}
                  />
                )}

                <span
                  className="vn-head"
                  aria-hidden="true"
                  style={{ left: `${progress * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* A recording otherwise only exists inside the document: there is
              no way to keep it, send it on, or hold on to it if the board goes
              away. The bytes are already here as a data URL, so saving one is
              a link and a click rather than a round trip to a server. */}
          <button
            type="button"
            className="vn-save"
            onClick={saveNote}
            aria-label="Save this voice note"
            data-tooltip="Save audio"
          >
            <Download size={13} />
          </button>

          <button
            type="button"
            className="vn-speed"
            onClick={() => setSpeedIndex((i) => (i + 1) % SPEEDS.length)}
            data-raised={speed !== 1 || undefined}
            aria-label={`Speed ${speed} times. Click to change.`}
            title="Playback speed"
          >
            {speed}×
          </button>
        </div>
      </Html>
    </>
  );
});

AudioRenderer.displayName = 'AudioRenderer';
