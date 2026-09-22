import React from 'react';
import { NavLink } from 'react-router-dom';

interface Props {
  isDarkTheme: boolean;
}

const Sidebar: React.FC<Props> = ({ isDarkTheme }) => {
  const sidebarStyle = {
    width: '250px',
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    borderRight: `1px solid ${isDarkTheme ? '#333' : '#e0e0e0'}`,
    padding: '20px 0',
    display: 'flex',
    flexDirection: 'column' as const,
    height: 'calc(100vh - 60px)',
    position: 'sticky' as const,
    top: '60px'
  };

  const navItemStyle = (isActive: boolean) => ({
    padding: '15px 20px',
    color: isActive ? '#1890ff' : (isDarkTheme ? '#ccc' : '#333'),
    textDecoration: 'none',
    fontWeight: isActive ? 'bold' : 'normal',
    backgroundColor: isActive ? (isDarkTheme ? '#333' : '#e6f7ff') : 'transparent',
    borderRight: isActive ? '3px solid #1890ff' : 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    transition: 'all 0.2s'
  });

  const links = [
    { to: "/", label: "Overview", icon: "📊" },
    { to: "/analytics", label: "Analytics", icon: "📈" },
    { to: "/threats", label: "Threat Intelligence", icon: "🛡️" },
    { to: "/logs", label: "Request Logs", icon: "📝" },
    { to: "/ml-performance", label: "ML Engine", icon: "🧠" },
    { to: "/settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <aside style={sidebarStyle}>
      <div style={{ marginBottom: '20px', padding: '0 20px', fontSize: '12px', color: isDarkTheme ? '#888' : '#888', fontWeight: 'bold' }}>
        MAIN NAVIGATION
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column' }}>
        {links.map((link) => (
          <NavLink 
            key={link.to} 
            to={link.to} 
            style={({ isActive }) => navItemStyle(isActive)}
          >
            <span>{link.icon}</span> {link.label}
          </NavLink>
        ))}
      </nav>
      
      <div style={{ marginTop: 'auto', padding: '20px' }}>
        <div style={{ 
          backgroundColor: isDarkTheme ? '#333' : '#f5f5f5', 
          padding: '15px', 
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '12px', color: isDarkTheme ? '#aaa' : '#666', marginBottom: '5px' }}>AEGIS Engine Status</div>
          <div style={{ color: '#00C49F', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: '#00C49F', borderRadius: '50%', display: 'inline-block' }}></span> Active
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
