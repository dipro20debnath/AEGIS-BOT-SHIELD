import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TrafficChartProps {
  data: any[];
}

export default function TrafficChart({ data }: TrafficChartProps) {
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorHuman" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#00ff88" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorBot" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ff3366" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#ff3366" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <XAxis dataKey="time" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#15151e', borderColor: '#27272a', color: '#f4f4f5' }}
            itemStyle={{ color: '#f4f4f5' }}
          />
          <Area type="monotone" dataKey="human" stroke="#00ff88" fillOpacity={1} fill="url(#colorHuman)" />
          <Area type="monotone" dataKey="bot" stroke="#ff3366" fillOpacity={1} fill="url(#colorBot)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
