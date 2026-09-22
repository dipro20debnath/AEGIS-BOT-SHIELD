import React, { ReactNode } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';

interface Props {
  children: ReactNode;
  isDarkTheme: boolean;
  toggleTheme: () => void;
}

const DashboardLayout: React.FC<Props> = ({ children, isDarkTheme, toggleTheme }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header isDarkTheme={isDarkTheme} toggleTheme={toggleTheme} />
      <div style={{ display: 'flex', flex: 1 }}>
        <Sidebar isDarkTheme={isDarkTheme} />
        <main style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
