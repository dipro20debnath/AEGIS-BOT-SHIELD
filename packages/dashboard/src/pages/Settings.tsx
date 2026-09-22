import React from 'react';

interface Props {
  isDarkTheme: boolean;
}

const Settings: React.FC<Props> = ({ isDarkTheme }) => {
  const cardStyle = {
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    marginBottom: '20px',
    maxWidth: '800px'
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '8px',
    fontWeight: 'bold',
    color: isDarkTheme ? '#ccc' : '#333'
  };

  const inputStyle = {
    width: '100%',
    padding: '10px',
    borderRadius: '4px',
    border: `1px solid ${isDarkTheme ? '#444' : '#ccc'}`,
    backgroundColor: isDarkTheme ? '#333' : '#fff',
    color: isDarkTheme ? '#fff' : '#000',
    marginBottom: '20px'
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px' }}>Protection Settings</h1>
      
      <div style={cardStyle}>
        <h3>General Configuration</h3>
        <hr style={{ borderTop: `1px solid ${isDarkTheme ? '#333' : '#eee'}`, margin: '15px 0' }} />
        
        <label style={labelStyle}>Protection Mode</label>
        <select style={inputStyle} defaultValue="balanced">
          <option value="lax">Lax (Monitor Only)</option>
          <option value="balanced">Balanced (Recommended)</option>
          <option value="strict">Strict (High False Positives possible)</option>
          <option value="paranoia">Paranoia (Block almost everything suspicious)</option>
        </select>

        <label style={labelStyle}>Challenge Type</label>
        <select style={inputStyle} defaultValue="invisible">
          <option value="invisible">Invisible PoW (Proof of Work)</option>
          <option value="captcha">Interactive CAPTCHA</option>
          <option value="js">JavaScript Challenge</option>
        </select>
      </div>

      <div style={cardStyle}>
        <h3>Machine Learning Engine</h3>
        <hr style={{ borderTop: `1px solid ${isDarkTheme ? '#333' : '#eee'}`, margin: '15px 0' }} />
        
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
          <input type="checkbox" id="auto_update" defaultChecked style={{ marginRight: '10px', transform: 'scale(1.2)' }} />
          <label htmlFor="auto_update" style={{ color: isDarkTheme ? '#ccc' : '#333', fontWeight: 'bold' }}>Enable Auto-Model Updates (Continuous Learning)</label>
        </div>

        <label style={labelStyle}>Risk Score Threshold for Block (0-100)</label>
        <input type="range" min="0" max="100" defaultValue="85" style={{ width: '100%', marginBottom: '20px' }} />
        
        <label style={labelStyle}>Risk Score Threshold for Challenge (0-100)</label>
        <input type="range" min="0" max="100" defaultValue="50" style={{ width: '100%', marginBottom: '20px' }} />
      </div>

      <button style={{ padding: '12px 24px', backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
        Save Changes
      </button>
    </div>
  );
};

export default Settings;
