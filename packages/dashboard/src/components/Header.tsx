import React from 'react';

interface Props {
  isDarkTheme: boolean;
  toggleTheme: () => void;
}

const Header: React.FC<Props> = ({ isDarkTheme, toggleTheme }) => {
  const headerStyle = {
    height: '60px',
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    borderBottom: `1px solid ${isDarkTheme ? '#333' : '#e0e0e0'}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    position: 'sticky' as const,
    top: 0,
    zIndex: 100
  };

  return (
    <header style={headerStyle}>
      <div style={{ fontWeight: 'bold', fontSize: '20px', letterSpacing: '1px' }}>
        <span style={{ color: '#1890ff' }}>AEGIS</span> BOT SHIELD
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <button 
          onClick={toggleTheme} 
          style={{ 
            background: 'none', border: 'none', cursor: 'pointer', 
            fontSize: '20px', color: isDarkTheme ? '#fff' : '#000' 
          }}
          title="Toggle Theme"
        >
          {isDarkTheme ? '☀️' : '🌙'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#1890ff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
            A
          </div>
          <span style={{ fontWeight: 'bold' }}>Admin</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
