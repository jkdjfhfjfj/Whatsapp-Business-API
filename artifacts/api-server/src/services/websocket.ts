import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

// Very small pub/sub: each connected client registers the businessId it belongs to (sent as the
// first message after connecting), and broadcasts are scoped to that business.

const businessSockets = new Map<string, Set<WebSocket>>();

export function initWebSocketServer(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let businessId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && typeof msg.businessId === 'string') {
          const id: string = msg.businessId;
          businessId = id;
          if (!businessSockets.has(id)) businessSockets.set(id, new Set());
          businessSockets.get(id)!.add(ws);
        }
      } catch {
        // ignore malformed client messages
      }
    });

    ws.on('close', () => {
      if (businessId) businessSockets.get(businessId)?.delete(ws);
    });
  });

  return wss;
}

export function broadcastToBusiness(businessId: string, event: string, payload: unknown) {
  const sockets = businessSockets.get(businessId);
  if (!sockets) return;
  const data = JSON.stringify({ event, payload });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}
