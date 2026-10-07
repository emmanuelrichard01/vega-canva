import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createCollab, type Collab } from './collab';
import { mintShareToken } from './shareToken';
import { fakePool, testConfig, waitFor } from './testSupport';
import type { Config } from './config';

/**
 * The collaboration socket end to end: a real Hocuspocus server on a real
 * port, real providers, and the server's own copy of the document checked
 * after each edit.
 */

const ROOM = 'collabRoom01';

let server: http.Server;
let collab: Collab;
let url: string;
let config: Config;
const providers: HocuspocusProvider[] = [];

async function start(overrides: Partial<Config> = {}) {
  config = testConfig(overrides);
  collab = createCollab({
    config,
    pool: fakePool([[/FROM rooms WHERE id/, () => ({ rows: [{ '?column?': 1 }] })]]) as any,
    sessionSecret: config.sessionSecret!,
    history: { add: () => {} },
    roomActivity: { touch: () => {} },
    sharedRedis: null,
  });
  server = http.createServer();
  collab.attach(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Connect and resolve once synced, or reject if authentication fails. */
function connect(token: Record<string, unknown> = {}): Promise<{ doc: Y.Doc; provider: HocuspocusProvider }> {
  const doc = new Y.Doc();
  return new Promise((resolve, reject) => {
    const provider = new HocuspocusProvider({
      url,
      name: ROOM,
      document: doc,
      token: JSON.stringify(token),
      WebSocketPolyfill: WebSocket,
      onSynced: () => resolve({ doc, provider }),
      onAuthenticationFailed: ({ reason }: { reason: string }) => reject(new Error(reason)),
    } as any);
    providers.push(provider);
  });
}

const invite = (role: 'viewer' | 'commenter' | 'editor') =>
  mintShareToken(config.shareSecret!, { roomId: ROOM, role });

const serverDoc = () => collab.hocuspocus.documents.get(ROOM)!;

/** Give a refused update time to have arrived, if it were going to. */
const settle = () => new Promise((r) => setTimeout(r, 250));

beforeEach(() => {
  providers.length = 0;
});

afterEach(async () => {
  for (const p of providers) p.destroy();
  collab.wss?.close();
  await new Promise((r) => server.close(r));
});

describe('collaboration socket', () => {
  it('applies an editor update', async () => {
    await start();
    const { doc } = await connect({ invite: invite('editor') });
    doc.getMap('objects').set('n1', 'drawn');
    await waitFor(() => serverDoc().getMap('objects').get('n1') === 'drawn', 3000, 'editor update');
  });

  it('keeps a viewer read-only', async () => {
    await start();
    const { doc } = await connect({ invite: invite('viewer') });
    doc.getMap('objects').set('n1', 'defaced');
    await settle();
    expect(serverDoc().getMap('objects').has('n1')).toBe(false);
  });

  it('lets a commenter comment', async () => {
    await start();
    const { doc } = await connect({ invite: invite('commenter') });
    const thread = new Y.Map<unknown>();
    thread.set('text', 'looks good');
    doc.getMap('comments').set('t1', thread);
    await waitFor(() => serverDoc().getMap('comments').has('t1'), 3000, 'commenter comment');
  });

  it('refuses a commenter edit, and the updates causally after it', async () => {
    await start();
    const { doc } = await connect({ invite: invite('commenter') });
    doc.getMap('objects').set('n1', 'defaced');
    // Depends on the refused struct, so it cannot be applied either.
    doc.getMap('comments').set('t1', new Y.Map());
    await settle();
    expect(serverDoc().getMap('objects').has('n1')).toBe(false);
    expect(serverDoc().getMap('comments').has('t1')).toBe(false);
  });

  it('refuses updates that would grow the document past its limit', async () => {
    await start({ collab: { maxDocumentBytes: 4096, maxPayloadBytes: 65536 } as Config['collab'] });
    const { doc } = await connect({ invite: invite('editor') });
    doc.getMap('objects').set('small', 'ok');
    await waitFor(() => serverDoc().getMap('objects').has('small'), 3000, 'small update');

    doc.getMap('objects').set('big', 'x'.repeat(3000));
    await waitFor(() => serverDoc().getMap('objects').has('big'), 3000, 'update under the limit');
    doc.getMap('objects').set('bigger', 'y'.repeat(3000));
    await settle();
    expect(serverDoc().getMap('objects').has('bigger')).toBe(false);
  });

  it('refuses a bare room id when signed invites are enforced', async () => {
    await start({ enforceShareTokens: true });
    await expect(connect({})).rejects.toThrow(/signed invite/);
  });

  it('refuses an invite for a different board', async () => {
    await start();
    const other = mintShareToken(config.shareSecret!, { roomId: 'otherRoom01', role: 'editor' });
    await expect(connect({ invite: other })).rejects.toThrow(/different board/);
  });

  it('bounds the frame size and the sockets per address', async () => {
    await start({ collab: { maxConnectionsPerIp: 1 } as Config['collab'] });
    expect(collab.wss?.options.maxPayload).toBe(config.collab.maxPayloadBytes);

    const first = new WebSocket(url);
    await new Promise((r) => first.once('open', r));
    const second = new WebSocket(url);
    const code = await new Promise<number>((r) => second.once('close', (c) => r(c)));
    expect(code).toBe(1008);
    first.close();
  });
});
