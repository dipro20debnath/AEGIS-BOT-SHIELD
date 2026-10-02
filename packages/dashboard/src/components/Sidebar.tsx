import React from 'react';
import { NavLink } from 'react-router-dom';
import { useApi } from '../api';
import { Theme, VERDICT_COLORS } from '../theme';

const links = [
  { to: '/', label: 'Overview', icon: '📊' },
  { to: '/analytics', label: 'Analytics', icon: '📈' },
  { to: '/threats', label: 'Threats', icon: '🛡️' },
  { to: '/logs', label: 'Request Logs', icon: '📝' },
  { to: '/ml-performance', label: 'ML Engine', icon: '🧠' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

const Sidebar: React.FC<{ theme: Theme }> = ({ theme }) => {
  const health = useApi<{ status: string }>('/aegis/health', 10000);
  const online = health.data?.status === 'ok' && !health.error;

  return (
    <aside style={{
      width: 230, backgroundColor: theme.surface, borderRight: `1px solid ${theme.border}`, padding: '20px 0',
      display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', position: 'sticky', top: 60,
    }}>
      <nav style={{ display: 'flex', flexDirection: 'column' }}>
        {links.map(link => (
          <NavLink key={link.to} to={link.to} end={link.to === '/'} style={({ isActive }) => ({
            padding: '12px 20px', textDecoration: 'none', display: 'flex', gap: 10,
            color: isActive ? theme.accent : theme.text, fontWeight: isActive ? 700 : 400,
            borderRight: isActive ? `3px solid ${theme.accent}` : '3px solid transparent',
          })}>
            <span aria-hidden>{link.icon}</span> {link.label}
          </NavLink>
        ))}
      </nav>
      <div style={{ marginTop: 'auto', padding: 20, fontSize: 13, color: theme.textSecondary }} role="status">
        Server:{' '}
        <span style={{ color: theme.text, fontWeight: 600 }}>
          <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6,
            backgroundColor: online ? VERDICT_COLORS.allow : VERDICT_COLORS.block }} />
          {health.loading ? 'checking…' : online ? 'online' : 'unreachable'}
        </span>
      </div>
    </aside>
  );
};

export default Sidebar;
