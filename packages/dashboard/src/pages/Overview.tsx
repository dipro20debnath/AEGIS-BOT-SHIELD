import React from 'react';
import StatsCard from '../components/StatsCard';
import TrafficChart from '../components/TrafficChart';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  isDarkTheme: boolean;
}

const threatData = [
  { name: 'Credential Stuffing', value: 400 },
  { name: 'DDoS', value: 300 },
  { name: 'Scraping', value: 300 },
  { name: 'Carding', value: 200 },
];
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

const recentThreats = [
  { id: '1', time: '10:05 AM', type: 'Scraping', ip: '192.168.1.1', severity: 'High' },
  { id: '2', time: '10:02 AM', type: 'Credential Stuffing', ip: '10.0.0.5', severity: 'Critical' },
  { id: '3', time: '09:55 AM', type: 'DDoS', ip: '172.16.0.2', severity: 'Medium' },
];

const Overview: React.FC<Props> = ({ isDarkTheme }) => {
  const cardStyle = {
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    marginBottom: '20px'
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px' }}>AEGIS BOT SHIELD Overview</h1>
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <StatsCard title="Total Requests" value="1,245,892" trend={5.2} isGood={true} isDarkTheme={isDarkTheme} />
        <StatsCard title="Blocked Bots" value="342,104" trend={12.5} isGood={true} isDarkTheme={isDarkTheme} />
        <StatsCard title="Challenge Rate" value="18.4%" trend={-2.1} isGood={true} isDarkTheme={isDarkTheme} />
        <StatsCard title="Avg Risk Score" value="34.2" trend={1.5} isGood={false} isDarkTheme={isDarkTheme} />
      </div>
      
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ ...cardStyle, flex: 2 }}>
          <h3>Real-time Traffic Overview</h3>
          <TrafficChart isDarkTheme={isDarkTheme} />
        </div>
        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>Threat Distribution</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={threatData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {threatData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
      <div style={{ ...cardStyle }}>
        <h3>Recent Detected Threats</h3>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#ddd'}`, color: isDarkTheme ? '#aaa' : '#555' }}>
              <th style={{ padding: '10px' }}>Time</th>
              <th style={{ padding: '10px' }}>Type</th>
              <th style={{ padding: '10px' }}>IP Address</th>
              <th style={{ padding: '10px' }}>Severity</th>
            </tr>
          </thead>
          <tbody>
            {recentThreats.map((t) => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#eee'}` }}>
                <td style={{ padding: '10px' }}>{t.time}</td>
                <td style={{ padding: '10px' }}>{t.type}</td>
                <td style={{ padding: '10px' }}>{t.ip}</td>
                <td style={{ padding: '10px', color: t.severity === 'Critical' ? '#ff4d4f' : t.severity === 'High' ? '#faad14' : '#1890ff' }}>
                  {t.severity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Overview;
