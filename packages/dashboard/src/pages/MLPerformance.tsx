import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, AreaChart, Area } from 'recharts';

interface Props {
  isDarkTheme: boolean;
}

const cmData = [
  { name: 'Predicted Bot', ActualBot: 9850, ActualHuman: 120 },
  { name: 'Predicted Human', ActualBot: 150, ActualHuman: 89000 },
];

const rocData = [
  { fpr: 0, tpr: 0 },
  { fpr: 0.05, tpr: 0.85 },
  { fpr: 0.1, tpr: 0.92 },
  { fpr: 0.2, tpr: 0.96 },
  { fpr: 0.5, tpr: 0.98 },
  { fpr: 1, tpr: 1 },
];

const historyData = [
  { epoch: 1, loss: 0.6, accuracy: 75 },
  { epoch: 5, loss: 0.4, accuracy: 85 },
  { epoch: 10, loss: 0.25, accuracy: 92 },
  { epoch: 15, loss: 0.15, accuracy: 96 },
  { epoch: 20, loss: 0.1, accuracy: 98.5 },
];

const MLPerformance: React.FC<Props> = ({ isDarkTheme }) => {
  const cardStyle = {
    backgroundColor: isDarkTheme ? '#1e1e1e' : '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    marginBottom: '20px'
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ marginBottom: '20px' }}>AEGIS ML Engine Performance</h1>
      
      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>Confusion Matrix</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cmData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkTheme ? '#333' : '#ccc'} />
                <XAxis dataKey="name" stroke={isDarkTheme ? '#ccc' : '#333'} />
                <YAxis stroke={isDarkTheme ? '#ccc' : '#333'} />
                <RechartsTooltip contentStyle={{ backgroundColor: isDarkTheme ? '#333' : '#fff', color: isDarkTheme ? '#fff' : '#000' }} />
                <Legend />
                <Bar dataKey="ActualBot" stackId="a" fill="#ff4d4f" />
                <Bar dataKey="ActualHuman" stackId="a" fill="#82ca9d" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>ROC Curve (AUC = 0.992)</h3>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rocData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkTheme ? '#333' : '#ccc'} />
                <XAxis dataKey="fpr" name="False Positive Rate" stroke={isDarkTheme ? '#ccc' : '#333'} />
                <YAxis name="True Positive Rate" stroke={isDarkTheme ? '#ccc' : '#333'} />
                <RechartsTooltip contentStyle={{ backgroundColor: isDarkTheme ? '#333' : '#fff', color: isDarkTheme ? '#fff' : '#000' }} />
                <Area type="monotone" dataKey="tpr" stroke="#8884d8" fill="#8884d8" fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>Model Comparison</h3>
          <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#ddd'}`, color: isDarkTheme ? '#aaa' : '#555' }}>
                <th style={{ padding: '10px' }}>Model</th>
                <th style={{ padding: '10px' }}>Accuracy</th>
                <th style={{ padding: '10px' }}>Precision</th>
                <th style={{ padding: '10px' }}>Recall</th>
                <th style={{ padding: '10px' }}>F1-Score</th>
              </tr>
            </thead>
            <tbody>
              {[{m: 'AEGIS Ensemble (Active)', a: '98.5%', p: '98.8%', r: '98.2%', f: '98.5%'},
                {m: 'XGBoost', a: '96.2%', p: '95.1%', r: '97.4%', f: '96.2%'},
                {m: 'Random Forest', a: '94.8%', p: '93.5%', r: '95.1%', f: '94.3%'},
                {m: 'Logistic Regression', a: '82.1%', p: '80.2%', r: '79.5%', f: '79.8%'}].map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${isDarkTheme ? '#333' : '#eee'}`, fontWeight: i === 0 ? 'bold' : 'normal', color: i === 0 ? '#1890ff' : (isDarkTheme ? '#fff' : '#000') }}>
                  <td style={{ padding: '10px' }}>{row.m}</td>
                  <td style={{ padding: '10px' }}>{row.a}</td>
                  <td style={{ padding: '10px' }}>{row.p}</td>
                  <td style={{ padding: '10px' }}>{row.r}</td>
                  <td style={{ padding: '10px' }}>{row.f}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ ...cardStyle, flex: 1 }}>
          <h3>Training History</h3>
          <div style={{ height: '250px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkTheme ? '#333' : '#ccc'} />
                <XAxis dataKey="epoch" stroke={isDarkTheme ? '#ccc' : '#333'} />
                <YAxis yAxisId="left" stroke="#82ca9d" />
                <YAxis yAxisId="right" orientation="right" stroke="#ff4d4f" />
                <RechartsTooltip contentStyle={{ backgroundColor: isDarkTheme ? '#333' : '#fff', color: isDarkTheme ? '#fff' : '#000' }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="accuracy" stroke="#82ca9d" name="Accuracy (%)" />
                <Line yAxisId="right" type="monotone" dataKey="loss" stroke="#ff4d4f" name="Loss" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MLPerformance;
