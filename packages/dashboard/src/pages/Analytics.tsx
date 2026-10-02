import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import ApiStatus from '../components/ApiStatus';
import { StatsEvent, StatsSummary, useApi } from '../api';
import { Theme, cardStyle } from '../theme';

const Analytics: React.FC<{ theme: Theme }> = ({ theme }) => {
  const stats = useApi<StatsSummary>('/aegis/stats');
  const events = useApi<StatsEvent[]>('/aegis/events?limit=500');
  const recent = events.data ?? [];

  const histogram = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}–${i * 10 + 9}`, count: 0 }));
    for (const e of recent) bins[Math.min(9, Math.floor(e.score / 10))].count++;
    return bins;
  }, [recent]);

  const paths = useMemo(() => {
    const byPath = new Map<string, { total: number; denied: number }>();
    for (const e of recent) {
      const p = byPath.get(e.path) ?? { total: 0, denied: 0 };
      p.total++;
      if (e.verdict === 'block' || e.verdict === 'challenge') p.denied++;
      byPath.set(e.path, p);
    }
    return [...byPath.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15);
  }, [recent]);

  const axis = { stroke: theme.axis, tick: { fill: theme.muted, fontSize: 12 } };
  const tooltip = { contentStyle: { backgroundColor: theme.surface, border: `1px solid ${theme.border}`, color: theme.text }, cursor: { fill: theme.grid } };
  const reasons = stats.data?.topReasons ?? [];
  const cell: React.CSSProperties = { padding: '8px', borderBottom: `1px solid ${theme.grid}` };

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>Analytics</h1>
      <ApiStatus loading={stats.loading} error={stats.error} hasData={!!stats.data} theme={theme} />

      <div style={cardStyle(theme)}>
        <h3 style={{ marginTop: 0 }}>Most frequent detection signals</h3>
        {reasons.length === 0 ? <div style={{ color: theme.textSecondary }}>No signals recorded yet.</div> : (
          <div style={{ height: Math.max(160, reasons.length * 34) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reasons} layout="vertical" margin={{ left: 40, right: 40 }}>
                <CartesianGrid horizontal={false} stroke={theme.grid} />
                <XAxis type="number" allowDecimals={false} {...axis} />
                <YAxis type="category" dataKey="reason" width={200} {...axis} />
                <Tooltip {...tooltip} />
                <Bar dataKey="count" name="requests" fill={theme.series1} radius={[0, 4, 4, 0]} barSize={18}>
                  <LabelList dataKey="count" position="right" fill={theme.textSecondary} fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={cardStyle(theme)}>
        <h3 style={{ marginTop: 0 }}>Risk score distribution (last {recent.length} requests)</h3>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogram}>
              <CartesianGrid vertical={false} stroke={theme.grid} />
              <XAxis dataKey="range" {...axis} />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip {...tooltip} />
              <Bar dataKey="count" name="requests" fill={theme.series1} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={cardStyle(theme)}>
        <h3 style={{ marginTop: 0 }}>Paths</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: theme.text, fontSize: 14 }}>
          <thead style={{ color: theme.textSecondary, textAlign: 'left' }}>
            <tr><th style={cell}>Path</th><th style={{ ...cell, textAlign: 'right' }}>Requests</th><th style={{ ...cell, textAlign: 'right' }}>Denied</th></tr>
          </thead>
          <tbody>
            {paths.map(([path, p]) => (
              <tr key={path}>
                <td style={cell}><code>{path}</code></td>
                <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.total}</td>
                <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {p.denied} ({((p.denied / p.total) * 100).toFixed(0)}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Analytics;
