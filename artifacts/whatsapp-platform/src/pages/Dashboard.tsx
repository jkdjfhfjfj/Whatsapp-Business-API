import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import { useToast } from '../Toast';

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api.getDashboard()
      .then(setData)
      .catch((err) => { setFailed(true); toast((err as Error).message, 'error'); })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="empty-state"><div className="skeleton skeleton-line" style={{ width: 160 }} /><p>Loading workspace metrics</p></div>;
  if (failed && !data) return <div className="empty-state"><strong>Metrics are unavailable</strong><p className="subtext">The inbox is still usable. Try loading the overview again.</p><button className="primary-action" onClick={load}>Retry</button></div>;
  if (!data) return null;

  return (
    <div className="dashboard">
      <h2>Overview</h2>
      <div className="stat-grid">
        <Card label="Total conversations" value={data.conversations.total} />
        <Card label="Open" value={data.conversations.open} />
        <Card label="Pending" value={data.conversations.pending} />
        <Card label="Resolved" value={data.conversations.resolved} />
        <Card label="Unread" value={data.conversations.unread} />
        <Card label="AI-enabled chats" value={data.conversations.aiHandled} />
      </div>

      <h3>Last 7 days</h3>
      <div className="stat-grid">
        <Card label="Messages today" value={data.messages.today} />
        <Card label="Messages (7d)" value={data.messages.last7Days} />
        <Card label="AI replies" value={data.messages.aiReplies} />
        <Card label="Agent replies" value={data.messages.agentReplies} />
        <Card label="Failed sends" value={data.messages.failed} />
      </div>

      <div className="chart-card">
        <h4>Message volume</h4>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.dailyVolume}>
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#25D366" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
