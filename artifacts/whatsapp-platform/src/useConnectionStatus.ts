import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const CHECK_INTERVAL_MS = 20000;

// Pings the backend's /health endpoint on an interval. Surfaced as a banner in App.tsx so
// "nothing is happening" has an immediate, visible explanation (server down/unreachable) instead
// of looking identical to a slow or silently-failing action.
export function useConnectionStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    }

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return online;
}
