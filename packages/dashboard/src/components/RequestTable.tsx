import React from 'react';

interface Log {
  id: string;
  time: string;
  ip: string;
  path: string;
  userAgent: string;
  verdict: string;
  riskScore: number;
  signals: string[];
}

interface Props {
  logs: Log[];
  isDarkTheme: boolean;
}

const RequestTable: React.FC<Props> = ({ logs, isDarkTheme }) => {
  const getVerdictStyle = (verdict: string) => {
    switch(verdict) {
      case 'Block': return { bg: '#ffe5e5', color: '#ff4d4f' };
      case 'Challenge': return { bg: '#fff1b8', color: '#faad14' };
      default: return { bg: '#e6f7ff', color: '#1890ff' };
    }
  };

  const getScoreColor = (score: number) => {
    if (score > 80) return '#ff4d4f';
    if (score > 50) return '#faad14';
    return '#00C49F';
  };

  return (
    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '14px' }}>
      <thead>
        <tr style={{ borderBottom: `2px solid ${isDarkTheme ? '#444' : '#ccc'}`, color: isDarkTheme ? '#aaa' : '#555' }}>
          <th style={{ padding: '12px' }}>Time</th>
          <th style={{ padding: '12px' }}>IP / Path</th>
          <th style={{ padding: '12px' }}>Verdict</th>
          <th style={{ padding: '12px' }}>Risk Score</th>
          <th style={{ padding: '12px' }}>Signals</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => {
          const vStyle = getVerdictStyle(log.verdict);
          const scoreColor = getScoreColor(log.riskScore);
          return (
            <tr key={log.id} style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#eee'}` }}>
              <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{log.time}</td>
              <td style={{ padding: '12px' }}>
                <div style={{ fontWeight: 'bold' }}>{log.ip}</div>
                <div style={{ color: isDarkTheme ? '#888' : '#888', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{log.path}</div>
              </td>
              <td style={{ padding: '12px' }}>
                <span style={{ backgroundColor: vStyle.bg, color: vStyle.color, padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                  {log.verdict}
                </span>
              </td>
              <td style={{ padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ width: '30px', fontWeight: 'bold', color: scoreColor }}>{log.riskScore}</span>
                  <div style={{ width: '100px', height: '8px', backgroundColor: isDarkTheme ? '#444' : '#eee', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${log.riskScore}%`, height: '100%', backgroundColor: scoreColor }}></div>
                  </div>
                </div>
              </td>
              <td style={{ padding: '12px' }}>
                {log.signals.length > 0 ? log.signals.map((sig, idx) => (
                  <span key={idx} style={{ display: 'inline-block', backgroundColor: isDarkTheme ? '#333' : '#f0f0f0', border: `1px solid ${isDarkTheme ? '#555' : '#ccc'}`, padding: '2px 6px', borderRadius: '4px', marginRight: '4px', marginBottom: '4px', fontSize: '12px' }}>
                    {sig}
                  </span>
                )) : <span style={{ color: isDarkTheme ? '#777' : '#aaa' }}>None</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default RequestTable;
