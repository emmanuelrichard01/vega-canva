/**
 * PKCE (RFC 7636) for Spotify's Authorization Code flow, entirely in the
 * browser: no client secret exists anywhere.
 */

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** A code verifier: 43–128 unreserved characters (we use 64). */
export function createVerifier(length = 64, random: (n: number) => Uint8Array = randomBytes): string {
  const n = Math.min(128, Math.max(43, length));
  const bytes = random(n);
  let out = '';
  // 256 % 66 != 0, so reject the top of the range to keep the choice uniform.
  const limit = 256 - (256 % UNRESERVED.length);
  let i = 0;
  let pool = bytes;
  while (out.length < n) {
    if (i >= pool.length) {
      pool = random(n);
      i = 0;
    }
    const b = pool[i++];
    if (b < limit) out += UNRESERVED[b % UNRESERVED.length];
  }
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** S256 challenge: base64url(SHA-256(verifier)). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** An opaque `state` value that ties the callback to the request. */
export const createState = () => base64Url(randomBytes(16));
