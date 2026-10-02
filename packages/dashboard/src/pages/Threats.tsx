import React, { useMemo } from 'react';
import ApiStatus from '../components/ApiStatus';
import RequestTable from '../components/RequestTable';
import { StatsEvent, useApi } from '../api';
import { Theme, cardStyle } from '../theme';

const Threats: React.FC<{ theme: Theme }> = ({ theme }) => {
  const events = useApi<StatsEvent[]>('/aegis/events?limit=500');
  const denied = useMemo(() => (events.data ?? []).filter(e => e.verdict === 'block' || e.verdict === 'challenge'), [events.data]);
  const reasons = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of denied) for (const r of e.reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [denied]);
  const cell: React.CSSProperties = { padding: '8px', borderBottom: `1px solid ${theme.grid}` };

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>Threats</h1>
      <ApiStatus loading={events.loading} error={events.error} hasData={!!events.data} theme={theme} />
      <div style={cardStyle(theme)}>
        <h3 style={{ marginTop: 0 }}>Signals behind denied requests</h3>
        {reasons.length === 0 ? <div style={{ color: theme.textSecondary }}>No denied requests in the recent window.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', color: theme.text, fontSize: 14 }}>
            <thead style={{ color: theme.textSecondary, textAlign: 'left' }}>
              <tr><th style={cell}>Signal</th><th style={{ ...cell, textAlign: 'right' }}>Denied requests</th></tr>
            </thead>
            <tbody>
              {reasons.map(([reason, count]) => (
                <tr key={reason}><td style={cell}><code>{reason}</code></td>
                  <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div style={cardStyle(theme)}>
        <h3 style={{ marginTop: 0 }}>Denied requests ({denied.length})</h3>
        <RequestTable theme={theme} events={denied} />
      </div>
    </div>
  );
};

export default Threats;
