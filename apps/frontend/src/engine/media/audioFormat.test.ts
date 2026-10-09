import { describe, expect, it } from 'vitest';
import {
  audioExtension,
  baseAudioType,
  extensionFromUrl,
  pickRecordingType,
  recordedAudioType,
  uploadAudioType,
} from './audioFormat';

describe('pickRecordingType', () => {
  it('prefers AAC in MP4, which every browser can play back', () => {
    expect(pickRecordingType(() => true)).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('falls through to Opus in WebM where MP4 cannot be recorded (Firefox)', () => {
    expect(pickRecordingType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
  });

  it('takes Safari’s bare MP4 when that is all it offers', () => {
    expect(pickRecordingType((t) => t === 'audio/mp4')).toBe('audio/mp4');
  });

  it('lets the browser choose when nothing matches or the check throws', () => {
    expect(pickRecordingType(() => false)).toBe('');
    expect(
      pickRecordingType(() => {
        throw new Error('nope');
      })
    ).toBe('');
    expect(pickRecordingType(undefined)).toBe('');
  });
});

describe('recordedAudioType', () => {
  it('trusts the recorder, then the first chunk, then guesses WebM', () => {
    expect(recordedAudioType('audio/mp4;codecs=mp4a.40.2', [])).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(recordedAudioType('', [{ type: 'audio/mp4' }])).toBe('audio/mp4');
    expect(recordedAudioType('', [{ type: '' }])).toBe('audio/webm');
  });
});

describe('names and types', () => {
  it('strips codec parameters', () => {
    expect(baseAudioType('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('names MP4 audio .m4a and never calls MP4 bytes .webm', () => {
    expect(audioExtension('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
    expect(audioExtension('audio/x-m4a')).toBe('m4a');
    expect(audioExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioExtension('audio/ogg;codecs=opus')).toBe('ogg');
  });

  it('uploads under a type on the server’s allow-list', () => {
    expect(uploadAudioType('audio/mp4;codecs=mp4a.40.2')).toBe('audio/mp4');
    expect(uploadAudioType('audio/x-m4a')).toBe('audio/mp4');
    expect(uploadAudioType('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('reads the extension off a stored URL', () => {
    expect(extensionFromUrl('https://api/rooms/r/media/abc.m4a')).toBe('m4a');
    expect(extensionFromUrl('https://api/rooms/r/media/abc.mp4')).toBe('m4a');
    expect(extensionFromUrl('https://api/rooms/r/media/abc.webm?x=1')).toBe('webm');
    expect(extensionFromUrl('local:abc')).toBeNull();
  });
});
