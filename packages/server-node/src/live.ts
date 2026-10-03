/**
 * WebSocket live feed of AEGIS decisions for the dashboard.
 *
 *   const server = app.listen(3000);
 *   attachLiveFeed(server, aegis, { authorize: req => isAdmin(req) });
 *
 * Messages (JSON, server to client only):
 *   {type: 'hello',   summary, events}   on connect: counters + the last 100 events
 *   {type: 'events',  events, dropped}   batched every flushMs (default 250 ms)
 *   {type: 'summary', summary}           at most every 2 s, when counters changed
 *
 * Events are batched so a traffic spike costs one message per client per
 * flush, not one per request; a batch holds at most maxBatch events and the
 * rest are counted in `dropped`. A client that cannot keep up (more than
 * 1 MB buffered) skips batches instead of growing the server's memory.
 *
 * Like the status API, the feed describes your traffic: pass `authorize`
 * in production. IPs are already truncated by AegisStats.
 *
 * With several instances each feed shows its own instance's traffic (the
 * counters are per process, see stats.ts).
 */
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { AegisNode } from './AegisNode.js';
import type { StatsEvent } from './stats.js';

export interface LiveFeedOptions {
  /** URL path of the feed (default /aegis/live) */
  path?: string;
  /** Return false to refuse the connection (401). Default: allow everyone */
  authorize?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /** Accepted Origin headers; default: any. Set it when the dashboard has a fixed origin */
  allowedOrigins?: string[];
  flushMs?: number;
  maxBatch?: number;
  maxClients?: number;
  /** Interval of keep-alive pings; clients that miss one are dropped (default 30 s) */
  heartbeatMs?: number;
}

export interface LiveFeed {
  readonly wss: WebSocketServer;
  clientCount(): number;
  close(): Promise<void>;
}

const MAX_BUFFERED = 1024 * 1024;

export function attachLiveFeed(server: Server, aegis: AegisNode, options: LiveFeedOptions = {}): LiveFeed {
  const path = options.path ?? '/aegis/live';
  const flushMs = options.flushMs ?? 250;
  const maxBatch = options.maxBatch ?? 200;
  const maxClients = options.maxClients ?? 100;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  let pending: StatsEvent[] = [];
  let dropped = 0;
  let lastSummaryAt = 0;
  let summaryDirty = false;

  const onEvent = (event: StatsEvent) => {
    summaryDirty = true;
    if (wss.clients.size === 0) return;
    if (pending.length < maxBatch) pending.push(event);
    else dropped++;
  };
  aegis.stats.on('event', onEvent);

  const broadcast = (message: string) => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN && client.bufferedAmount < MAX_BUFFERED) client.send(message);
    }
  };

  const flushTimer = setInterval(() => {
    if (pending.length || dropped) {
      broadcast(JSON.stringify({ type: 'events', events: pending, dropped }));
      pending = [];
      dropped = 0;
    }
    const now = Date.now();
    if (summaryDirty && now - lastSummaryAt >= 2000 && wss.clients.size) {
      broadcast(JSON.stringify({ type: 'summary', summary: aegis.stats.summary() }));
      summaryDirty = false;
      lastSummaryAt = now;
    }
  }, flushMs);
  flushTimer.unref?.();

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) { client.terminate(); continue; }
      alive.set(client, false);
      client.ping();
    }
  }, options.heartbeatMs ?? 30_000);
  heartbeat.unref?.();

  const reject = (socket: Duplex, status: number, text: string) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== path) {
      // Another upgrade handler may own this path; with none, refuse instead of leaving the socket open
      if (server.listenerCount('upgrade') === 1) reject(socket, 404, 'Not Found');
      return;
    }
    try {
      if (options.allowedOrigins && !options.allowedOrigins.includes(req.headers.origin ?? '')) return reject(socket, 403, 'Forbidden');
      if (options.authorize && !(await options.authorize(req))) return reject(socket, 401, 'Unauthorized');
      if (wss.clients.size >= maxClients) return reject(socket, 503, 'Service Unavailable');
    } catch {
      return reject(socket, 500, 'Internal Server Error');
    }
    wss.handleUpgrade(req, socket, head, ws => {
      aegis.metrics.liveClients.set(wss.clients.size);
      ws.on('close', () => aegis.metrics.liveClients.set(wss.clients.size));
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      ws.on('message', () => { /* the feed is one-way; client messages are ignored */ });
      ws.on('error', () => ws.terminate());
      ws.send(JSON.stringify({ type: 'hello', summary: aegis.stats.summary(), events: aegis.stats.recent(100) }));
    });
  };
  server.on('upgrade', onUpgrade);

  return {
    wss,
    clientCount: () => wss.clients.size,
    close: () => new Promise<void>(resolve => {
      clearInterval(flushTimer);
      clearInterval(heartbeat);
      aegis.stats.off('event', onEvent);
      server.off('upgrade', onUpgrade);
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolve());
    }),
  };
}
