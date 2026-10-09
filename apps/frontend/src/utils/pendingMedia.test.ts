import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetPendingMedia, holdObjectUrl, registerLocalMedia, releaseLocalMedia } from './pendingMedia';

describe('holdObjectUrl', () => {
  afterEach(() => {
    __resetPendingMedia();
    vi.restoreAllMocks();
  });

  function stubUrls() {
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++n}`);
    return vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }

  it('does not revoke a blob a player is still reading when its upload lands', () => {
    const revoke = stubUrls();
    const url = registerLocalMedia('u1', new Blob(['x'], { type: 'audio/mp4' }));
    const letGo = holdObjectUrl(url);
    releaseLocalMedia('u1');
    expect(revoke).not.toHaveBeenCalled();
    letGo();
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it('revokes at once when nothing holds the blob', () => {
    const revoke = stubUrls();
    const url = registerLocalMedia('u2', new Blob(['x']));
    releaseLocalMedia('u2');
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it('keeps a held blob that was never released, and ignores other URLs', () => {
    const revoke = stubUrls();
    const url = registerLocalMedia('u3', new Blob(['x']));
    holdObjectUrl(url)();
    expect(revoke).not.toHaveBeenCalled();
    expect(() => holdObjectUrl('https://x/y.m4a')()).not.toThrow();
  });
});
