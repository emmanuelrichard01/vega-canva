import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import zlib from 'zlib';
import type { Readable } from 'stream';
import { BlockedAddressError, guardedLookup, isBlockedHostname, isPublicAddress } from './netGuard';

/**
 * A GET that is safe to aim at an address a user typed.
 *
 * Everything `fetch` would do for you, done by hand so that each step can be
 * refused:
 *
 *  - **Only http and https, only ports 80 and 443, no credentials in the URL.**
 *    A preview has no business talking to a mail server on port 25 or a Redis
 *    on 6379, even a public one.
 *  - **Every connection resolves through `guardedLookup`**, so the address
 *    checked is the address connected to. Literal IPs, which skip lookup, are
 *    checked up front.
 *  - **Redirects are followed by hand, at most `maxRedirects`, and every hop is
 *    checked again from the top.** A public page that redirects to
 *    `http://127.0.0.1/` is the oldest way around a guard that only looks at
 *    the first URL.
 *  - **One deadline for the whole exchange**, redirects included, and a byte
 *    cap counted *after* decompression, so a 1KB gzip bomb cannot become 4GB
 *    of memory.
 *  - No proxy environment variables, no cookies, no keep-alive agent shared
 *    with anything else.
 */

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  /** Keep the first `maxBytes` and stop, rather than failing. For HTML, whose head is all we read. */
  truncate?: boolean;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

export class FetchRefused extends Error {
  code: 'blocked' | 'unsupported' | 'timeout' | 'too-large' | 'unreachable' | 'redirects';
  constructor(message: string, code: FetchRefused['code']) {
    super(message);
    this.code = code;
    this.name = 'FetchRefused';
  }
}

export const USER_AGENT = 'Mozilla/5.0 (compatible; VegaLinkPreview/1.0; +https://vega.app/bot)';

/** Throws `FetchRefused` for any URL this module will not open. */
export function checkFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused('That is not a web address', 'unsupported');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchRefused('Only web pages can be previewed', 'unsupported');
  }
  if (url.username || url.password) {
    throw new FetchRefused('Addresses with a login in them are not fetched', 'unsupported');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new FetchRefused('Only the standard web ports are fetched', 'blocked');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new FetchRefused('That address is not on the public internet', 'blocked');
  } else if (isBlockedHostname(host)) {
    throw new FetchRefused('That address is not on the public internet', 'blocked');
  }
  return url;
}

const lookup = guardedLookup((hostname, options, cb) => dns.lookup(hostname, options, cb));

function decode(stream: Readable, encoding: string | undefined): Readable {
  switch ((encoding ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return stream.pipe(zlib.createGunzip());
    case 'deflate':
      return stream.pipe(zlib.createInflate());
    case 'br':
      return stream.pipe(zlib.createBrotliDecompress());
    default:
      return stream;
  }
}

function requestOnce(url: URL, options: Required<Omit<SafeFetchOptions, 'maxRedirects'>>, signal: AbortSignal) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup: lookup as never,
        agent: false,
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: options.accept,
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en;q=0.9, *;q=0.5',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // A redirect's body is not read; the caller follows the Location.
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false });
          return;
        }
        const declared = Number(res.headers['content-length']);
        if (!options.truncate && Number.isFinite(declared) && declared > options.maxBytes) {
          res.destroy();
          reject(new FetchRefused('That file is too large to preview', 'too-large'));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const body = decode(res, res.headers['content-encoding'] as string | undefined);
        const finish = (truncated: boolean) => {
          if (settled) return;
          settled = true;
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated });
        };
        body.on('data', (chunk: Buffer) => {
          if (settled) return;
          const room = options.maxBytes - size;
          if (chunk.length > room) {
            if (!options.truncate) {
              settled = true;
              res.destroy();
              reject(new FetchRefused('That file is too large to preview', 'too-large'));
              return;
            }
            chunks.push(chunk.subarray(0, room));
            size += room;
            res.destroy();
            finish(true);
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        body.on('end', () => finish(false));
        body.on('error', (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const options = {
    timeoutMs: opts.timeoutMs ?? 8000,
    maxBytes: opts.maxBytes ?? 2 * 1024 * 1024,
    accept: opts.accept ?? '*/*',
    truncate: opts.truncate ?? false,
  };
  const maxRedirects = opts.maxRedirects ?? 4;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    let url = checkFetchableUrl(raw);
    for (let hop = 0; ; hop++) {
      let res;
      try {
        res = await requestOnce(url, options, controller.signal);
      } catch (err) {
        if (err instanceof FetchRefused) throw err;
        if (err instanceof BlockedAddressError || (err as Error)?.name === 'BlockedAddressError') {
          throw new FetchRefused('That address is not on the public internet', 'blocked');
        }
        if (controller.signal.aborted) throw new FetchRefused('That page took too long to answer', 'timeout');
        throw new FetchRefused('That page could not be reached', 'unreachable');
      }

      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (hop >= maxRedirects) throw new FetchRefused('That page redirects too many times', 'redirects');
        let next: string;
        try {
          next = new URL(String(res.headers.location), url).href;
        } catch {
          throw new FetchRefused('That page redirects somewhere unreadable', 'unreachable');
        }
        url = checkFetchableUrl(next);
        continue;
      }

      return {
        url: url.href,
        status: res.status,
        contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
        body: res.body,
        truncated: res.truncated,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
