import { describe, it, expect } from 'vitest';
import { createOriginCheck, normalizeOrigin, parseOriginRule } from './cors';

describe('normalizeOrigin', () => {
  it('keeps a plain origin as itself', () => {
    expect(normalizeOrigin('https://app.example.com')).toBe('https://app.example.com');
  });

  it('drops the trailing slash a browser address bar shows', () => {
    expect(normalizeOrigin('https://app.example.com/')).toBe('https://app.example.com');
  });

  it('drops a path somebody pasted along with the origin', () => {
    expect(normalizeOrigin('https://app.example.com/board/abc')).toBe('https://app.example.com');
  });

  it('lower-cases the scheme and host', () => {
    expect(normalizeOrigin('HTTPS://App.Example.COM')).toBe('https://app.example.com');
  });

  it('drops a default port and keeps a non-default one', () => {
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com');
    expect(normalizeOrigin('http://example.com:80')).toBe('http://example.com');
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('refuses anything that is not an http(s) origin', () => {
    expect(normalizeOrigin('app.example.com')).toBeNull();
    expect(normalizeOrigin('file:///tmp/x.html')).toBeNull();
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });
});

describe('parseOriginRule', () => {
  it('reads a plain origin', () => {
    expect(parseOriginRule('https://app.example.com/')).toEqual({ origin: 'https://app.example.com' });
  });

  it('reads a leading-label wildcard', () => {
    expect(parseOriginRule('https://*.vercel.app')).toEqual({
      wildcard: { scheme: 'https', suffix: 'vercel.app' },
    });
  });

  it('refuses a wildcard over a bare TLD', () => {
    expect(parseOriginRule('https://*.com')).toBeNull();
  });

  it('refuses the entries people actually mistype', () => {
    expect(parseOriginRule('*')).toBeNull();
    expect(parseOriginRule('app.example.com')).toBeNull();
    expect(parseOriginRule('https://app.*.com')).toBeNull();
  });
});

describe('createOriginCheck', () => {
  it('admits everything only for the explicit wildcard', () => {
    const check = createOriginCheck('*');
    expect(check('https://anything.example.com')).toBe(true);
  });

  it('admits a listed origin however it was spelled in the config', () => {
    const check = createOriginCheck(['HTTPS://App.Example.com/']);
    expect(check('https://app.example.com')).toBe(true);
  });

  it('admits a listed origin however the browser spelled it', () => {
    const check = createOriginCheck(['https://app.example.com']);
    expect(check('https://app.example.com:443')).toBe(true);
  });

  it('refuses an origin that is not on the list', () => {
    const check = createOriginCheck(['https://app.example.com']);
    expect(check('https://evil.example.com')).toBe(false);
    expect(check('http://app.example.com')).toBe(false);
    expect(check('https://app.example.com:8443')).toBe(false);
  });

  it('refuses everything when the list is empty', () => {
    const check = createOriginCheck([]);
    expect(check('https://app.example.com')).toBe(false);
  });

  it('matches preview deployments through a wildcard', () => {
    const check = createOriginCheck(['https://*.vercel.app']);
    expect(check('https://vega-canva-git-main.vercel.app')).toBe(true);
    expect(check('https://deep.nested.vercel.app')).toBe(true);
  });

  it('does not let a wildcard admit the apex or a lookalike host', () => {
    const check = createOriginCheck(['https://*.example.com']);
    expect(check('https://example.com')).toBe(false);
    expect(check('https://notexample.com')).toBe(false);
    expect(check('https://evilexample.com')).toBe(false);
    // The suffix appearing anywhere but at the end must not match.
    expect(check('https://example.com.evil.net')).toBe(false);
  });

  it('holds a wildcard to its scheme and the default port', () => {
    const check = createOriginCheck(['https://*.example.com']);
    expect(check('http://app.example.com')).toBe(false);
    expect(check('https://app.example.com:8443')).toBe(false);
  });

  it('ignores an unusable entry instead of admitting everything', () => {
    const check = createOriginCheck(['*', 'https://app.example.com']);
    expect(check('https://app.example.com')).toBe(true);
    expect(check('https://evil.com')).toBe(false);
  });
});
