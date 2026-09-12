import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const botTypeData = [
  { name: 'Scrapers', count: 4000 },
  { name: 'Spam Bots', count: 3000 },
  { name: 'Scalpers', count: 2000 },
  { name: 'Vulnerability Scanners', count: 2780 },
  { name: 'Impersonators', count: 1890 },
];

export default function Analytics() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-aegis-panel p-6 rounded-lg border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">Bot Breakdown</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={botTypeData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                <XAxis type="number" stroke="#a1a1aa" />
                <YAxis dataKey="name" type="category" stroke="#a1a1aa" width={120} />
                <Tooltip contentStyle={{ backgroundColor: '#15151e', borderColor: '#27272a' }} />
                <Bar dataKey="count" fill="#ff3366" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="bg-aegis-panel p-6 rounded-lg border border-gray-800 flex flex-col justify-center items-center text-aegis-muted">
          <h2 className="text-lg font-semibold mb-4 self-start">Geographic Distribution</h2>
          <p>[ Interactive Map Placeholder ]</p>
        </div>
      </div>
    </div>
  );
}
