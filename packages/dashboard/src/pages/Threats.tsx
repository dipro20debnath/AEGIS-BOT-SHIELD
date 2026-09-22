import React, { useState } from 'react';

interface Props {
  isDarkTheme: boolean;
}

const mockThreats = [
  { id: 'OAT-018', name: 'Credential Stuffing', severity: 'Critical', status: 'Active', detected: '2023-10-25 10:15:00' },
  { id: 'OAT-011', name: 'Scraping', severity: 'High', status: 'Active', detected: '2023-10-25 09:30:00' },
  { id: 'OAT-004', name: 'Fingerprinting', severity: 'Medium', status: 'Mitigated', detected: '2023-10-24 15:45:00' },
  { id: 'OAT-014', name: 'Vulnerability Scanning', severity: 'High', status: 'Active', detected: '2023-10-25 11:20:00' },
];

const Threats: React.FC<Props> = ({ isDarkTheme }) => {
  const [filter, setFilter] = useState('All');
  
  const cardStyle = {
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    marginBottom: '20px'
  };

  const inputStyle = {
    padding: '8px',
    borderRadius: '4px',
    border: `1px solid ${isDarkTheme ? '#444' : '#ccc'}`,
    backgroundColor: isDarkTheme ? '#333' : '#fff',
    color: isDarkTheme ? '#fff' : '#000',
    marginRight: '10px'
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px' }}>Threat Intelligence (OWASP OAT)</h1>
      
      <div style={{ ...cardStyle }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <label style={{ marginRight: '10px' }}>Filter by Severity: </label>
            <select style={inputStyle} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="All">All</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
            </select>
          </div>
          <button style={{ padding: '8px 16px', backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Export JSON
          </button>
        </div>

        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#ddd'}`, color: isDarkTheme ? '#aaa' : '#555' }}>
              <th style={{ padding: '10px' }}>OAT ID</th>
              <th style={{ padding: '10px' }}>Threat Name</th>
              <th style={{ padding: '10px' }}>Severity</th>
              <th style={{ padding: '10px' }}>Status</th>
              <th style={{ padding: '10px' }}>Detected At</th>
              <th style={{ padding: '10px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {mockThreats.filter(t => filter === 'All' || t.severity === filter).map(t => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#eee'}` }}>
                <td style={{ padding: '10px', fontWeight: 'bold' }}>{t.id}</td>
                <td style={{ padding: '10px' }}>{t.name}</td>
                <td style={{ padding: '10px' }}>
                  <span style={{ 
                    padding: '4px 8px', borderRadius: '12px', fontSize: '0.85em',
                    backgroundColor: t.severity === 'Critical' ? '#ffe5e5' : t.severity === 'High' ? '#fff1b8' : '#e6f7ff',
                    color: t.severity === 'Critical' ? '#ff4d4f' : t.severity === 'High' ? '#faad14' : '#1890ff'
                  }}>
                    {t.severity}
                  </span>
                </td>
                <td style={{ padding: '10px' }}>{t.status}</td>
                <td style={{ padding: '10px' }}>{t.detected}</td>
                <td style={{ padding: '10px' }}>
                  <button style={{ backgroundColor: 'transparent', border: '1px solid #1890ff', color: '#1890ff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>View Details</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle }}>
        <h3>IP Blocklist Management</h3>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <input type="text" placeholder="IP Address (e.g., 192.168.1.1)" style={{ ...inputStyle, flex: 1 }} />
          <input type="text" placeholder="Reason" style={{ ...inputStyle, flex: 2 }} />
          <button style={{ padding: '8px 16px', backgroundColor: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Add to Blocklist
          </button>
        </div>
        <p style={{ color: isDarkTheme ? '#aaa' : '#666' }}>Currently blocking 1,452 IPs.</p>
      </div>
    </div>
  );
};

export default Threats;
