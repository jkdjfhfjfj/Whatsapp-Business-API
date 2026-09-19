const PALETTE = ['#f97316', '#ef4444', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#eab308', '#ec4899'];

function colorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export default function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initial = (name || '?').trim()[0]?.toUpperCase() ?? '?';
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: colorFor(name || '?') }}
    >
      {initial}
    </div>
  );
}
