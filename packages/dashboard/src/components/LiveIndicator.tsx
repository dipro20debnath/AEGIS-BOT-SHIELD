import React from 'react';
import { LiveStatus } from '../api';
import { Theme } from '../theme';

const LABELS: Record<LiveStatus, { text: string; title: string }> = {
  live: { text: 'Live', title: 'Updates are pushed over the WebSocket feed (/aegis/live)' },
  polling: { text: 'Polling every 5 s', title: 'WebSocket unavailable; reading the REST API and retrying the socket' },
  connecting: { text: 'Connecting…', title: 'Opening the WebSocket feed' },
};

/** How the page receives data. A text label carries the state; the dot only repeats it. */
const LiveIndicator: React.FC<{ status: LiveStatus; theme: Theme }> = ({ status, theme }) => (
  <span role="status" title={LABELS[status].title}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: theme.textSecondary, fontWeight: 500 }}>
    <span aria-hidden style={{
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: status === 'live' ? '#0ca30c' : status === 'polling' ? '#fab219' : theme.muted,
    }} />
    {LABELS[status].text}
  </span>
);

export default LiveIndicator;
