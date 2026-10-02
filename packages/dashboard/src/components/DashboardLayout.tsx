import React, { ReactNode } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import { Theme } from '../theme';

interface Props {
  children: ReactNode;
  theme: Theme;
  toggleTheme: () => void;
}

const DashboardLayout: React.FC<Props> = ({ children, theme, toggleTheme }) => (
  <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
    <Header theme={theme} toggleTheme={toggleTheme} />
    <div style={{ display: 'flex', flex: 1 }}>
      <Sidebar theme={theme} />
      <main style={{ flex: 1, minWidth: 0, color: theme.text }}>{children}</main>
    </div>
  </div>
);

export default DashboardLayout;
