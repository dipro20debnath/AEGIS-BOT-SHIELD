import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { StatsEvent } from '../api';
import { Theme, VERDICT_COLORS, VERDICT_ORDER } from '../theme';

interface Props {
  events: StatsEvent[];
  theme: Theme;
}

/** Requests per minute, stacked by verdict (status colours, with a legend). Not animated: live updates would restart the animation. */
const TrafficChart: React.FC<Props> = ({ events, theme }) => {
  const data = useMemo(() => {
    const buckets = new Map<number, Record<string, number>>();
    for (const e of events) {
      const minute = Math.floor(e.timestamp / 60000) * 60000;
      const bucket = buckets.get(minute) ?? { allow: 0, monitor: 0, challenge: 0, block: 0 };
      bucket[e.verdict] = (bucket[e.verdict] ?? 0) + 1;
      buckets.set(minute, bucket);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0])
      .map(([minute, counts]) => ({ time: new Date(minute).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ...counts }));
  }, [events]);

  if (data.length === 0) {
    return <div style={{ color: theme.textSecondary, padding: 20 }}>No requests recorded yet.</div>;
  }
  const present = VERDICT_ORDER.filter(v => data.some(d => (d as Record<string, unknown>)[v]));

  return (
    <div style={{ height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="time" stroke={theme.axis} tick={{ fill: theme.muted, fontSize: 12 }} />
          <YAxis allowDecimals={false} stroke={theme.axis} tick={{ fill: theme.muted, fontSize: 12 }} />
          <Tooltip cursor={{ fill: theme.grid }} contentStyle={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}`, color: theme.text }} />
          <Legend formatter={(value: string) => <span style={{ color: theme.textSecondary }}>{value}</span>} />
          {present.map((verdict, i) => (
            <Bar key={verdict} dataKey={verdict} stackId="v" fill={VERDICT_COLORS[verdict]} name={verdict}
              stroke={theme.surface} strokeWidth={1} isAnimationActive={false}
              radius={i === present.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrafficChart;
