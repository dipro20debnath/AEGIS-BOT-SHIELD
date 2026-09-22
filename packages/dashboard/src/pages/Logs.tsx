import React, { useState } from 'react';
import RequestTable from '../components/RequestTable';

interface Props {
  isDarkTheme: boolean;
}

const mockLogs = Array.from({ length: 20 }).map((_, i) => ({
  id: `req-${i}`,
  time: new Date(Date.now() - i * 60000).toISOString().replace('T', ' ').substring(0, 19),
  ip: `192.168.1.${(i % 255) + 1}`,
  path: i % 3 === 0 ? '/login' : i % 2 === 0 ? '/api/data' : '/checkout',
  userAgent: i % 4 === 0 ? 'Python-urllib/3.8' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
  verdict: i % 5 === 0 ? 'Block' : i % 4 === 0 ? 'Challenge' : 'Allow',
  riskScore: i % 5 === 0 ? Math.floor(Math.random() * 20) + 80 : Math.floor(Math.random() * 50),
  signals: i % 5 === 0 ? ['headless_browser', 'fast_typing'] : [],
}));

const Logs: React.FC<Props> = ({ isDarkTheme }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('All');

  const cardStyle = {
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
  };

  const inputStyle = {
    padding: '8px',
    borderRadius: '4px',
    border: `1px solid ${isDarkTheme ? '#444' : '#ccc'}`,
    backgroundColor: isDarkTheme ? '#333' : '#fff',
    color: isDarkTheme ? '#fff' : '#000',
    marginRight: '10px'
  };

  const filteredLogs = mockLogs.filter(log => {
    const matchesSearch = log.ip.includes(searchTerm) || log.path.includes(searchTerm) || log.userAgent.includes(searchTerm);
    const matchesVerdict = verdictFilter === 'All' || log.verdict === verdictFilter;
    return matchesSearch && matchesVerdict;
  });

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px' }}>Request Logs</h1>
      
      <div style={{ ...cardStyle, marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text" 
            placeholder="Search IP, Path, User-Agent..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ ...inputStyle, width: '300px' }} 
          />
          <select style={inputStyle} value={verdictFilter} onChange={(e) => setVerdictFilter(e.target.value)}>
            <option value="All">All Verdicts</option>
            <option value="Allow">Allow</option>
            <option value="Challenge">Challenge</option>
            <option value="Block">Block</option>
          </select>
        </div>
        <button style={{ padding: '8px 16px', backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Export CSV
        </button>
      </div>

      <div style={{ ...cardStyle }}>
        <RequestTable logs={filteredLogs} isDarkTheme={isDarkTheme} />
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button style={{ ...inputStyle, cursor: 'pointer' }}>Previous</button>
          <span style={{ padding: '8px', color: isDarkTheme ? '#aaa' : '#555' }}>Page 1 of 45</span>
          <button style={{ ...inputStyle, cursor: 'pointer' }}>Next</button>
        </div>
      </div>
    </div>
  );
};

export default Logs;
