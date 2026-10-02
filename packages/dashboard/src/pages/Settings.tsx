import React from 'react';
import ApiStatus from '../components/ApiStatus';
import { ServerConfig, useApi } from '../api';
import { Theme, cardStyle } from '../theme';

/** Read-only view of the running server's configuration (change it in the server code or environment). */
const Settings: React.FC<{ theme: Theme }> = ({ theme }) => {
  const config = useApi<ServerConfig>('/aegis/config', 0);
  const c = config.data;
  const row = (label: string, value: React.ReactNode) => (
    <tr key={label}>
      <th style={{ textAlign: 'left', padding: 8, color: theme.textSecondary, borderBottom: `1px solid ${theme.grid}`, width: 260 }}>{label}</th>
      <td style={{ padding: 8, borderBottom: `1px solid ${theme.grid}` }}>{value}</td>
    </tr>
  );
  const list = (items: string[] | 'all') => (items === 'all' ? 'all paths' : items.length ? items.map(p => <code key={p} style={{ marginRight: 8 }}>{p}</code>) : '—');

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>Settings</h1>
      <ApiStatus loading={config.loading} error={config.error} hasData={!!c} theme={theme} />
      {c && (
        <div style={{ ...cardStyle(theme), maxWidth: 900 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', color: theme.text }}>
            <tbody>
              {row('Mode', c.mode === 'monitor' ? 'monitor (never blocks)' : 'enforce')}
              {row('Block threshold', c.thresholds.block)}
              {row('Challenge threshold', c.thresholds.challenge)}
              {row('Paths requiring a token', list(c.requireTokenPaths))}
              {row('Protected paths', list(c.protectedPaths))}
              {row('Excluded paths', list(c.excludedPaths))}
              {row('Token lifetime', `${c.tokenTtl} s`)}
              {row('ML scoring', c.mlEnabled ? 'enabled (ML service)' : 'disabled (rules only)')}
              {row('Site key', c.siteKeyConfigured ? 'configured' : 'missing')}
            </tbody>
          </table>
          <p style={{ color: theme.muted, fontSize: 13 }}>Configuration is set where the server is created; the dashboard only displays it.</p>
        </div>
      )}
    </div>
  );
};

export default Settings;
