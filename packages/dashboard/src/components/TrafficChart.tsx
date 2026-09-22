import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Props {
  isDarkTheme: boolean;
}

const data = [
  { time: '00:00', human: 4000, bot: 8400 },
  { time: '04:00', human: 3000, bot: 9398 },
  { time: '08:00', human: 12000, bot: 3800 },
  { time: '12:00', human: 27800, bot: 3908 },
  { time: '16:00', human: 18900, bot: 4800 },
  { time: '20:00', human: 23900, bot: 3800 },
  { time: '24:00', human: 3490, bot: 7300 },
];

const TrafficChart: React.FC<Props> = ({ isDarkTheme }) => {
  return (
    <div style={{ height: '300px', width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{
            top: 5,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={isDarkTheme ? '#333' : '#ccc'} />
          <XAxis dataKey="time" stroke={isDarkTheme ? '#ccc' : '#333'} />
          <YAxis stroke={isDarkTheme ? '#ccc' : '#333'} />
          <Tooltip 
            contentStyle={{ backgroundColor: isDarkTheme ? '#333' : '#fff', color: isDarkTheme ? '#fff' : '#000', border: 'none' }}
          />
          <Legend />
          <Line type="monotone" dataKey="human" stroke="#00C49F" activeDot={{ r: 8 }} name="Human Traffic" strokeWidth={2} />
          <Line type="monotone" dataKey="bot" stroke="#ff4d4f" name="Bot Traffic" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrafficChart;
