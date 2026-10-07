import type { IncomingMessage } from 'http';

/**
 * The client address of a WebSocket upgrade, by the same rule Express uses
 * for `req.ip`.
 *
 * Express's `trust proxy fn` answers "is this hop a proxy we trust?" for each
 * address, nearest first. The client is the first address that is not
 * trusted: the socket peer, then `X-Forwarded-For` read right to left. With
 * no proxy trusted this is the socket peer, so a client cannot choose its own
 * address by sending the header.
 */
export type TrustFn = (address: string, hop: number) => boolean;

export function upgradeClientAddress(request: IncomingMessage, trust: TrustFn | undefined): string {
  const peer = request.socket?.remoteAddress ?? 'unknown';
  if (!trust) return peer;

  const header = request.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse();
  const addresses = [peer, ...forwarded];

  for (let hop = 0; hop < addresses.length - 1; hop++) {
    if (!trust(addresses[hop], hop)) return addresses[hop];
  }
  return addresses[addresses.length - 1];
}

/**
 * Open sockets per client address, with a ceiling.
 *
 * Each socket can hold several documents, and each document a Y.Doc in
 * memory, so connections are the unit a single address is limited on.
 */
export class ConnectionCounter {
  private open = new Map<string, number>();

  constructor(private readonly max: number) {}

  /** Count a new socket; false when the address is already at the ceiling. */
  acquire(address: string): boolean {
    const count = this.open.get(address) ?? 0;
    if (count >= this.max) return false;
    this.open.set(address, count + 1);
    return true;
  }

  release(address: string): void {
    const count = this.open.get(address) ?? 0;
    if (count <= 1) this.open.delete(address);
    else this.open.set(address, count - 1);
  }

  count(address: string): number {
    return this.open.get(address) ?? 0;
  }
}
