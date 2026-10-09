import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Rect } from 'react-konva';
import { Html } from 'react-konva-utils';
import { Captions, Clock3, Download, LoaderCircle, Pause, Play, RotateCw, TriangleAlert } from 'lucide-react';
import type { AudioNode } from '../../../engine/model/schema';
import { applyNodePatches, DERIVED_ORIGIN } from '../../../engine/document';
import { isElectedWriter } from '../../../engine/document/election';
import { useCameraZoom } from '../../../engine/useCameraZoom';
import { relativeTime } from '../../../engine/comments/threads';
import { canRetryUpload, retryUpload, uploadFraction, useUploadState } from '../../../engine/media/upload';
import { audioExtension, extensionFromUrl } from '../../../engine/media/audioFormat';
import { Avatar } from '../../ui/Avatar';
import '../../media/voiceNote.css';
import { holdObjectUrl, localMediaType, uploadIdFromSrc, useResolvedSrc } from '../../../utils/pendingMedia';
import {
  audioCardSize,
  barCountFor,
  claimPlayback,
  clamp01,
  classifyMediaError,
  formatAuthorShortName,
  formatClock,
  fractionFromPointer,
  isFatalPlayRejection,
  keyboardSeek,
  nextElementSrc,
  normalizeWaveform,
  playbackReadout,
  releasePlayback,
  resampleWaveform,
  resolveDurationMs,
  seekSeconds,
  type AudioLoadFailure,
} from '../../../engine/model/audioPlayback';

interface Props {
  node: AudioNode;
}

/** Cycled by the speed chip. Slower than 1× is absent by design. */
const SPEEDS = [1, 1.5, 2] as const;

/** Below this zoom the meta row is unreadable, so the card draws only its play button and waveform. */
const FAR_ZOOM = 0.45;

/** One automatic reload for a network failure: a free-tier server waking up fails the first request. */
const AUTO_RETRY_MS = 1500;

/** A minute clock shared by every note, so "2m ago" moves on without one timer per card. */
let minuteNow = Date.now();
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | null = null;
function subscribeMinute(fn: () => void) {
  minuteListeners.add(fn);
  if (!minuteTimer) {
    minuteTimer = setInterval(() => {
      minuteNow = Date.now();
      minuteListeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    minuteListeners.delete(fn);
    if (minuteListeners.size === 0 && minuteTimer) {
      clearInterval(minuteTimer);
      minuteTimer = null;
    }
  };
}
const getMinute = () => minuteNow;

/** Save a recording under a name the operating system will open. */
async function saveRecording(src: string, ext: string, createdAt: number | undefined) {
  const stamp = new Date(createdAt ?? Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const filename = `voice-note-${stamp}.${ext}`;
  const click = (href: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    click(src);
    return;
  }
  // `download` is ignored on a cross-origin link, which would open a player
  // tab instead of saving. Fetching the bytes first keeps it a download.
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    click(url);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    window.open(src, '_blank', 'noopener');
  }
}

/**
 * Voice note player.
 *
 * A DOM overlay rather than Konva shapes, because it needs real audio
 * controls. Two consequences that are easy to lose and hard to diagnose:
 *
 * - **The node needs a `Rect` with a fill underneath it**, purely so it exists
 *   in Konva's hit graph. Without one the note cannot be selected or dragged.
 * - **The card is `pointer-events: none`** and only its controls opt back in,
 *   so a press on the background falls through to the canvas and reaches the
 *   rect.
 *
 * ## Where the sound comes from
 *
 * A fresh take plays from its blob on the recorder's device the moment it is
 * placed, while it uploads. The stored URL replaces it when the upload lands,
 * but never mid-sentence (`nextElementSrc`), and the blob is held until the
 * element has let go of it (`holdObjectUrl`). Every failure is named with an
 * action: an upload the server refused offers Retry, a load that failed offers
 * Retry and Download, and a collaborator without the bytes sees that the note
 * is still on its way rather than that it is broken.
 *
 * ## Why progress is a clip and not coloured bars
 *
 * The played portion is a second copy of the waveform revealed with
 * `clip-path`. Both layers lay out identically, so the bars register by
 * construction and the edge moves continuously, driven by one frame loop for
 * the whole board, because only one note can play.
 */
export const AudioRenderer: React.FC<Props> = React.memo(({ node }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * Listeners are wired from a **ref callback**, not an effect: `Html` mounts
   * its children after this component's effects run, so an effect reading
   * `audioRef.current` would find `null` and never bind.
   */
  const detachRef = useRef<(() => void) | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const autoRetriedRef = useRef(false);
  const resumeAtRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [elementSeconds, setElementSeconds] = useState<number | undefined>(undefined);
  const [loadFailure, setLoadFailure] = useState<AudioLoadFailure | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const scrubbingRef = useRef(false);
  scrubbingRef.current = scrubbing;
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const transcript = node.transcript?.trim() ?? '';

  const zoom = useCameraZoom();
  const now = useSyncExternalStore(subscribeMinute, getMinute, getMinute);

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

  /** A `local:` src becomes a playable object URL here, or '' on a device without the bytes. */
  const { src: playableSrc, pendingUpload } = useResolvedSrc(node.src);
  const upload = useUploadState(node.src);
  const uploadId = uploadIdFromSrc(node.src);

  const [elementSrc, setElementSrc] = useState(playableSrc);
  useEffect(() => {
    const next = nextElementSrc(elementSrc, playableSrc, isPlaying);
    if (next === elementSrc) return;
    // Paused part-way, the stored copy picks up where the blob left off; a
    // take that played to its end starts over.
    const el = audioRef.current;
    const at = el && !el.ended && el.duration - el.currentTime > 0.05 ? el.currentTime : 0;
    resumeAtRef.current = at > 0 ? at : null;
    if (!(at > 0)) {
      setEngaged(false);
      setCurrentSeconds(0);
    }
    setElementSrc(next);
  }, [playableSrc, isPlaying, elementSrc]);

  // The blob stays valid for as long as the element holds it.
  useEffect(() => holdObjectUrl(elementSrc), [elementSrc]);

  // A new source is a fresh start for failure handling.
  useEffect(() => {
    setLoadFailure(null);
    autoRetriedRef.current = false;
  }, [elementSrc]);

  /** Advance the playhead every frame while playing; `timeupdate` alone is ~4Hz. */
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
   * Bind to the element once, and read what it already knows: metadata can
   * arrive before the listener does, so `el.duration` is read on attach.
   */
  const attachAudio = useCallback((el: HTMLAudioElement | null) => {
    detachRef.current?.();
    detachRef.current = null;
    audioRef.current = el;
    if (!el) return;

    const readMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setElementSeconds(el.duration);
      const resumeAt = resumeAtRef.current;
      if (resumeAt !== null && el.readyState >= 1) {
        resumeAtRef.current = null;
        el.currentTime = resumeAt;
      }
    };
    const onTime = () => {
      if (!scrubbingRef.current) setCurrentSeconds(el.currentTime);
    };
    const onEnd = () => {
      releasePlayback(el);
      setIsPlaying(false);
      setBuffering(false);
      setEngaged(false);
      setCurrentSeconds(0);
      el.currentTime = 0;
    };
    const onPlay = () => {
      setIsPlaying(true);
      setEngaged(true);
    };
    const onPause = () => {
      releasePlayback(el);
      setIsPlaying(false);
      setBuffering(false);
    };
    const onWaiting = () => setBuffering(true);
    const onReady = () => setBuffering(false);
    const onError = () => {
      // An element with no source, or one whose source has already moved on,
      // has nothing to say about the recording.
      if (!el.getAttribute('src') || !el.error) return;
      const failure = classifyMediaError(el.error.code);
      setIsPlaying(false);
      setBuffering(false);
      if (failure === 'network' && !autoRetriedRef.current) {
        autoRetriedRef.current = true;
        window.setTimeout(() => {
          if (audioRef.current === el) el.load();
        }, AUTO_RETRY_MS);
        return;
      }
      setLoadFailure(failure);
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
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onReady);
    el.addEventListener('canplay', onReady);
    el.addEventListener('error', onError);

    detachRef.current = () => {
      el.removeEventListener('loadedmetadata', readMeta);
      el.removeEventListener('durationchange', readMeta);
      el.removeEventListener('canplay', readMeta);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onReady);
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('error', onError);
    };
  }, []);

  /**
   * Backfill a duration the document never recorded. A fact about the
   * recording, not an edit: one editor's tab writes it, outside undo, and a
   * viewer never tries.
   */
  useEffect(() => {
    if (node.durationMs > 0) return;
    if (!Number.isFinite(elementSeconds) || !((elementSeconds as number) > 0)) return;
    if (!isElectedWriter()) return;
    applyNodePatches([{ id: node.id, changes: { durationMs: Math.round((elementSeconds as number) * 1000) } }], {
      origin: DERIVED_ORIGIN,
    });
  }, [elementSeconds, node.durationMs, node.id]);

  // A fresh `src` resets `playbackRate`, so this is re-applied on both.
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed, elementSrc]);

  // Leaving the board mid-sentence should not keep talking.
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        releasePlayback(el);
        el.pause();
      }
    };
  }, []);

  const playable = !!elementSrc && !loadFailure;

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !playable) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    claimPlayback(el);
    el.play().catch((err) => {
      setIsPlaying(false);
      setBuffering(false);
      if (isFatalPlayRejection(err)) setLoadFailure('unsupported');
    });
  }, [playable]);

  const retryLoad = useCallback(() => {
    const el = audioRef.current;
    setLoadFailure(null);
    autoRetriedRef.current = false;
    el?.load();
  }, []);

  const retryUploadNow = useCallback(() => {
    if (uploadId) void retryUpload(uploadId);
  }, [uploadId]);

  const saveNote = useCallback(() => {
    if (!elementSrc) return;
    // The bytes' own type where this device holds them; otherwise the stored
    // URL's extension. Never assumed: a `.webm` holding MP4 will not open.
    const localType = localMediaType(node.src);
    const ext = localType ? audioExtension(localType) : (extensionFromUrl(node.src) ?? 'webm');
    void saveRecording(elementSrc, ext, node.createdAt);
  }, [elementSrc, node.src, node.createdAt]);

  const seekTo = useCallback(
    (fraction: number) => {
      const el = audioRef.current;
      if (!el || !(durationSeconds > 0)) return;
      const time = seekSeconds(fraction, durationSeconds);
      setCurrentSeconds(time);
      setEngaged(true);
      if (Number.isFinite(time)) el.currentTime = time;
    },
    [durationSeconds]
  );

  const fractionAt = useCallback((clientX: number) => {
    const rect = waveRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return fractionFromPointer(clientX, rect.left, rect.width);
  }, []);

  const seekable = durationSeconds > 0 && playable;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!seekable) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    const fraction = fractionAt(e.clientX);
    setHoverFraction(fraction);
    seekTo(fraction);
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
    if (e.pointerType !== 'mouse') setHoverFraction(null);
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

  // ---- What the card says about itself --------------------------------------

  const waitingForBytes = pendingUpload && !playableSrc;
  const fraction = uploadFraction(upload);
  const uploadFailed = upload?.phase === 'failed';
  const canRetry = uploadFailed && !!uploadId && canRetryUpload(uploadId);

  type CardState = 'ready' | 'uploading' | 'queued' | 'upload-failed' | 'waiting' | 'load-failed';
  const cardState: CardState = loadFailure
    ? 'load-failed'
    : waitingForBytes
      ? 'waiting'
      : uploadFailed
        ? 'upload-failed'
        : upload?.phase === 'queued'
          ? 'queued'
          : upload?.phase === 'uploading'
            ? 'uploading'
            : 'ready';

  const size = audioCardSize(node.width, node.height);
  const far = zoom < FAR_ZOOM;
  const playSize = size === 'lg' ? 18 : 16;
  const name = formatAuthorShortName(node.author.name);
  const when = node.createdAt ? relativeTime(node.createdAt, Math.max(now, Date.now() - 1000)) : '';
  const bubbleFraction = scrubbing || hoverFraction !== null ? (hoverFraction ?? progress) : null;

  const status: { text: string; tone: 'quiet' | 'syncing' | 'danger'; title?: string } | null =
    cardState === 'uploading'
      ? { text: fraction !== null && fraction > 0 ? `Uploading ${Math.round(fraction * 100)}%` : 'Uploading', tone: 'quiet' }
      : cardState === 'queued'
        ? { text: 'Uploads when online', tone: 'syncing', title: 'Saved on this device. It uploads when the connection is back.' }
        : cardState === 'upload-failed'
          ? { text: 'Upload failed', tone: 'danger', title: upload?.phase === 'failed' ? upload.reason : undefined }
          : cardState === 'waiting'
            ? { text: 'Still uploading', tone: 'syncing', title: `${name}’s device has not finished uploading this note.` }
            : null;

  const playLabel = loadFailure
    ? 'Recording unavailable'
    : waitingForBytes
      ? 'Waiting for upload'
      : isPlaying
        ? 'Pause voice note'
        : 'Play voice note';

  const playIcon = loadFailure ? (
    <TriangleAlert size={playSize} />
  ) : waitingForBytes ? (
    <Clock3 size={playSize} />
  ) : buffering && isPlaying ? (
    <LoaderCircle size={playSize} className="vn-spin" />
  ) : isPlaying ? (
    <Pause size={playSize} fill="currentColor" strokeWidth={0} />
  ) : (
    <Play size={playSize} fill="currentColor" strokeWidth={0} className="vn-play-glyph" />
  );

  // Percent of the track height, so a full-amplitude peak fills it. The floor
  // keeps a visible thread through silence.
  const waveBars = bars.map((value, i) => (
    <span key={i} className="vn-bar" style={{ height: `${Math.max(12, value * 100)}%` }} />
  ));

  const RING_R = 21;
  const RING_C = 2 * Math.PI * RING_R;

  return (
    <>
      {/* The node's hit area. Without a filled shape here, a voice note cannot
          be selected or dragged. */}
      <Rect width={node.width} height={node.height} cornerRadius={16} fill="transparent" />

      <Html divProps={{ style: { pointerEvents: 'none' } }}>
        <div
          className="vn"
          data-size={size}
          data-far={far || undefined}
          data-state={cardState}
          data-playing={isPlaying || undefined}
          style={{ width: node.width, minHeight: node.height, ['--vn-accent' as string]: node.author.color }}
        >
          {elementSrc && <audio ref={attachAudio} src={elementSrc} preload="metadata" />}

          <span className="vn-play-wrap">
            <button
              type="button"
              className="vn-play"
              onClick={togglePlay}
              disabled={!playable}
              aria-label={playLabel}
              aria-pressed={isPlaying}
            >
              {playIcon}
            </button>
            {cardState === 'uploading' && (
              <svg className="vn-ring" viewBox="0 0 46 46" aria-hidden="true">
                <circle className="vn-ring__track" cx="23" cy="23" r={RING_R} />
                <circle
                  className="vn-ring__fill"
                  cx="23"
                  cy="23"
                  r={RING_R}
                  strokeDasharray={RING_C}
                  strokeDashoffset={RING_C * (1 - (fraction ?? 0))}
                />
              </svg>
            )}
          </span>

          <div className="vn-body">
            <div className="vn-main">
              {loadFailure ? (
                <div className="vn-fail" role="alert">
                  <span className="vn-fail__text">
                    {loadFailure === 'network' ? 'Couldn’t load this recording' : 'This browser can’t play this recording'}
                  </span>
                  {loadFailure === 'network' && (
                    <button type="button" className="vn-text-btn" onClick={retryLoad}>
                      <RotateCw size={12} aria-hidden="true" />
                      Retry
                    </button>
                  )}
                  <button type="button" className="vn-text-btn" onClick={saveNote}>
                    <Download size={12} aria-hidden="true" />
                    Download
                  </button>
                </div>
              ) : (
                <div
                  ref={waveRef}
                  className="vn-wave"
                  role="slider"
                  tabIndex={seekable ? 0 : -1}
                  aria-label={`Seek in ${name}’s voice note`}
                  aria-disabled={!seekable || undefined}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(durationSeconds)}
                  aria-valuenow={Math.round(currentSeconds)}
                  aria-valuetext={`${formatClock(currentSeconds * 1000)} of ${formatClock(durationMs)}`}
                  data-scrubbing={scrubbing || undefined}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onPointerLeave={() => !scrubbing && setHoverFraction(null)}
                  onKeyDown={onKeyDown}
                >
                  <div className="vn-layer" aria-hidden="true">
                    {waveBars}
                  </div>
                  <div
                    className="vn-layer vn-played"
                    aria-hidden="true"
                    style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
                  >
                    {waveBars}
                  </div>
                  {(isPlaying || scrubbing || (engaged && currentSeconds > 0)) && (
                    <span className="vn-head" aria-hidden="true" style={{ left: `${progress * 100}%` }} />
                  )}
                  {bubbleFraction !== null && seekable && (
                    <span className="vn-bubble" aria-hidden="true" style={{ left: `${bubbleFraction * 100}%` }}>
                      {formatClock(seekSeconds(bubbleFraction, durationSeconds) * 1000)}
                    </span>
                  )}
                </div>
              )}
              {!loadFailure && (
                <span className="vn-clock" aria-hidden="true" title={`${formatClock(currentSeconds * 1000)} of ${formatClock(durationMs)}`}>
                  {playbackReadout(currentSeconds, durationMs, engaged || isPlaying)}
                </span>
              )}
            </div>

            <div className="vn-meta">
              <span className="vn-who" title={node.author.name || 'Anonymous'}>
                <Avatar name={node.author.name || 'Anonymous'} color={node.author.color} size={size === 'lg' ? 18 : 16} />
                <span className="vn-name">{name}</span>
              </span>
              {status ? (
                <span className="vn-status" data-tone={status.tone} title={status.title}>
                  {status.text}
                  {canRetry && (
                    <button type="button" className="vn-text-btn vn-text-btn--inline" onClick={retryUploadNow}>
                      Retry
                    </button>
                  )}
                </span>
              ) : (
                when && (
                  <span className="vn-when">
                    <span aria-hidden="true">·</span> {when}
                  </span>
                )
              )}
              <span className="vn-actions">
                <button
                  type="button"
                  className="vn-chip"
                  onClick={() => setSpeedIndex((i) => (i + 1) % SPEEDS.length)}
                  data-raised={speed !== 1 || undefined}
                  disabled={!playable}
                  aria-label={`Playback speed ${speed}×. Change speed.`}
                  data-tooltip="Playback speed"
                >
                  {speed}×
                </button>
                {transcript && (
                  <button
                    type="button"
                    className="vn-icon-btn"
                    onClick={() => setShowTranscript((v) => !v)}
                    aria-expanded={showTranscript}
                    aria-label={showTranscript ? 'Hide transcript' : 'Show transcript'}
                    data-tooltip={showTranscript ? 'Hide transcript' : 'Transcript'}
                  >
                    <Captions size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="vn-icon-btn"
                  onClick={saveNote}
                  disabled={!elementSrc}
                  aria-label="Download this voice note"
                  data-tooltip="Download"
                >
                  <Download size={13} />
                </button>
              </span>
            </div>
          </div>
        </div>
        {transcript && showTranscript && (
          <div className="vn-transcript" style={{ width: node.width }} role="region" aria-label="Transcript">
            <p className="vn-transcript__text">{transcript}</p>
            <span className="vn-transcript__note">Transcribed by the recorder’s browser. It may contain mistakes.</span>
          </div>
        )}
      </Html>
    </>
  );
});

AudioRenderer.displayName = 'AudioRenderer';
