import React from 'react';
import { Theme, cardStyle } from '../theme';

interface Props {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  theme: Theme;
}

/** Explains why there is no data instead of showing empty or invented numbers. */
const ApiStatus: React.FC<Props> = ({ loading, error, hasData, theme }) => {
  if (hasData && !error) return null;
  if (loading) return <div style={{ ...cardStyle(theme), color: theme.textSecondary }}>Loading…</div>;
  return (
    <div role="alert" style={{ ...cardStyle(theme), borderColor: '#d03b3b', color: theme.text }}>
      <strong>Cannot reach the AEGIS server status API</strong>{error ? ` (${error})` : ''}.
      {hasData ? ' Showing the last data received.' : ''}
      <div style={{ color: theme.textSecondary, marginTop: 6, fontSize: 14 }}>
        Start a server (e.g. <code>node examples/express-integration/server.js</code>) and run the dashboard with{' '}
        <code>AEGIS_API=http://localhost:3000 npm run dev -w packages/dashboard</code>.
      </div>
    </div>
  );
};

export default ApiStatus;
