import { useEffect, useRef } from 'react';

// Mirrors api.ts: same-origin by default (single-service deployment), or VITE_API_URL in dev
// when the client and server run as two separate processes.
const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const WS_URL = configuredApiUrl
  ? configuredApiUrl.replace(/^http/, 'ws')
  : `${window.location.origin.replace(/^http/, 'ws')}`;

export function useRealtime(businessId: string | undefined, onEvent: (event: string, payload: unknown) => void) {
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!businessId) return;
    const ws = new WebSocket(`${WS_URL}/ws`);
    socketRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', businessId }));
    ws.onmessage = (msg) => {
      try {
        const { event, payload } = JSON.parse(msg.data);
        onEvent(event, payload);
      } catch {
        // ignore malformed messages
      }
    };

    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);
}
