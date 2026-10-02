import React from 'react';
import { StatsEvent, formatTime } from '../api';
import { Theme } from '../theme';
import VerdictBadge from './VerdictBadge';

interface Props {
  events: StatsEvent[];
  theme: Theme;
}

const RequestTable: React.FC<Props> = ({ events, theme }) => {
  const cell: React.CSSProperties = { padding: '10px 8px', borderBottom: `1px solid ${theme.grid}`, verticalAlign: 'top' };
  if (events.length === 0) return <div style={{ color: theme.textSecondary }}>No matching requests.</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
        <thead>
          <tr style={{ color: theme.textSecondary }}>
            <th style={cell}>Time</th>
            <th style={cell}>Path</th>
            <th style={cell}>Verdict</th>
            <th style={{ ...cell, textAlign: 'right' }}>Score</th>
            <th style={cell}>Reasons</th>
            <th style={cell}>IP prefix</th>
          </tr>
        </thead>
        <tbody style={{ color: theme.text }}>
          {events.map((e, i) => (
            <tr key={`${e.timestamp}-${i}`}>
              <td style={{ ...cell, whiteSpace: 'nowrap' }}>{formatTime(e.timestamp)}</td>
              <td style={cell}><code>{e.path}</code>{e.telemetry && <span style={{ color: theme.muted }}> (telemetry)</span>}</td>
              <td style={cell}><VerdictBadge verdict={e.verdict} /></td>
              <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.score.toFixed(1)}</td>
              <td style={{ ...cell, color: theme.textSecondary }}>{e.reasons.join(', ') || '—'}</td>
              <td style={{ ...cell, color: theme.textSecondary, whiteSpace: 'nowrap' }}>{e.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RequestTable;
