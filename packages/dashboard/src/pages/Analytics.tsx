import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';

interface Props {
  isDarkTheme: boolean;
}

const botTypeData = [
  { name: 'Simple Script', value: 45000 },
  { name: 'Headless Browser', value: 23000 },
  { name: 'Sophisticated (Human-like)', value: 12000 },
  { name: 'Crawler/Scraper', value: 34000 },
];

const detectionMetrics = [
  { time: '00:00', accuracy: 98.2, falsePositives: 1.2 },
  { time: '04:00', accuracy: 98.5, falsePositives: 1.1 },
  { time: '08:00', accuracy: 97.9, falsePositives: 1.5 },
  { time: '12:00', accuracy: 98.8, falsePositives: 0.9 },
  { time: '16:00', accuracy: 99.1, falsePositives: 0.7 },
  { time: '20:00', accuracy: 98.4, falsePositives: 1.3 },
];

const featureImportance = [
  { feature: 'Mouse Dynamics', importance: 0.85 },
  { feature: 'Keystroke Dynamics', importance: 0.75 },
  { feature: 'Scroll Behavior', importance: 0.65 },
  { feature: 'Touch Events', importance: 0.55 },
  { feature: 'Device Fingerprint', importance: 0.92 },
  { feature: 'Network Fingerprint', importance: 0.88 },
  { feature: 'Behavioral Sequence', importance: 0.72 },
];

const topCountries = [
  { country: 'Russia', requests: '1.2M', threatLevel: 'High' },
  { country: 'China', requests: '950K', threatLevel: 'High' },
  { country: 'United States', requests: '800K', threatLevel: 'Medium' },
  { country: 'Brazil', requests: '450K', threatLevel: 'Medium' },
  { country: 'Vietnam', requests: '300K', threatLevel: 'Low' },
];

const Analytics: React.FC<Props> = ({ isDarkTheme }) => {
  const cardStyle = {
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    marginBottom: '20px'
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px' }}>Deep Analytics</h1>
      
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>Bot Type Distribution</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={botTypeData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkTheme ? '#333' : '#ccc'} />
                <XAxis type="number" stroke={isDarkTheme ? '#ccc' : '#333'} />
                <YAxis dataKey="name" type="category" width={150} stroke={isDarkTheme ? '#ccc' : '#333'} />
                <RechartsTooltip contentStyle={{ backgroundColor: isDarkTheme ? '#333' : '#fff', color: isDarkTheme ? '#fff' : '#000' }} />
                <Legend />
                <Bar dataKey="value" fill="#8884d8" name="Bot Volume" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>Detection Accuracy Metrics (Last 24h)</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={detectionMetrics}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkTheme ? '#333' : '#ccc'} />
                <XAxis dataKey="time" stroke={isDarkTheme ? '#ccc' : '#333'} />
                <YAxis yAxisId="left" stroke="#82ca9d" />
                <YAxis yAxisId="right" orientation="right" stroke="#ff7300" />
                <RechartsTooltip contentStyle={{ backgroundColor: isDarkTheme ? '#333' : '#fff', color: isDarkTheme ? '#fff' : '#000' }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="accuracy" stroke="#82ca9d" name="Accuracy (%)" />
                <Line yAxisId="right" type="monotone" dataKey="falsePositives" stroke="#ff7300" name="FP Rate (%)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>Geographic Threat Map (Top Origins)</h3>
          <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#ddd'}`, color: isDarkTheme ? '#aaa' : '#555' }}>
                <th style={{ padding: '10px' }}>Country</th>
                <th style={{ padding: '10px' }}>Malicious Requests</th>
                <th style={{ padding: '10px' }}>Threat Level</th>
              </tr>
            </thead>
            <tbody>
              {topCountries.map((c, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#eee'}` }}>
                  <td style={{ padding: '10px' }}>{c.country}</td>
                  <td style={{ padding: '10px' }}>{c.requests}</td>
                  <td style={{ padding: '10px', color: c.threatLevel === 'High' ? '#ff4d4f' : c.threatLevel === 'Medium' ? '#faad14' : '#1890ff' }}>
                    {c.threatLevel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>ML Feature Importance</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={featureImportance} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkTheme ? '#333' : '#ccc'} />
                <XAxis dataKey="feature" stroke={isDarkTheme ? '#ccc' : '#333'} angle={-45} textAnchor="end" height={80} />
                <YAxis stroke={isDarkTheme ? '#ccc' : '#333'} />
                <RechartsTooltip contentStyle={{ backgroundColor: isDarkTheme ? '#333' : '#fff', color: isDarkTheme ? '#fff' : '#000' }} />
                <Bar dataKey="importance" fill="#00C49F" name="Importance Score" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
