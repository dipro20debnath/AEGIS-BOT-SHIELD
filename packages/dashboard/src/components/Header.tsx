import React from 'react';
import { Theme } from '../theme';

interface Props {
  theme: Theme;
  toggleTheme: () => void;
}

const Header: React.FC<Props> = ({ theme, toggleTheme }) => (
  <header style={{
    height: 60, backgroundColor: theme.surface, borderBottom: `1px solid ${theme.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px',
    position: 'sticky', top: 0, zIndex: 100,
  }}>
    <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: 1, color: theme.text }}>
      <span style={{ color: theme.accent }}>AEGIS</span> BOT SHIELD
    </div>
    <button onClick={toggleTheme} aria-label={theme.dark ? 'Switch to light theme' : 'Switch to dark theme'}
      style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: theme.text }}>
      {theme.dark ? '☀️ Light' : '🌙 Dark'}
    </button>
  </header>
);

export default Header;
