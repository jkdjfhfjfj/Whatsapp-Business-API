import { useEffect, useRef } from 'react';

// Mirrors api.ts: same-origin by default (single-service deployment), or VITE_API_URL in dev
// when the client and server run as two separate processes.
const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const WS_URL = configuredApiUrl
  ? configuredApiUrl.replace(/^http/, 'ws')
  : `${window.location.origin.replace(/^http/, 'ws')}`;

export function useRealtime(businessId: string | undefined, onEvent: (event: string, payload: unknown) => void) {
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!businessId) return;

    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(`${WS_URL}/ws`);
      socketRef.current = ws;

      ws.onopen = () => ws?.send(JSON.stringify({ type: 'subscribe', businessId }));
      ws.onmessage = (msg) => {
        try {
          const { event, payload } = JSON.parse(msg.data);
          onEventRef.current(event, payload);
        } catch {
          // Ignore malformed messages instead of taking down the live connection.
        }
      };
      ws.onclose = () => {
        if (!stopped) reconnectTimer = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      socketRef.current = null;
    };
  }, [businessId]);
}
