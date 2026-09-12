import React from 'react';
import { Activity, ShieldAlert, Users, Zap } from 'lucide-react';
import StatsCard from '../components/StatsCard';
import TrafficChart from '../components/TrafficChart';
import RequestTable from '../components/RequestTable';

const mockChartData = [
  { time: '00:00', human: 400, bot: 240 },
  { time: '04:00', human: 300, bot: 139 },
  { time: '08:00', human: 200, bot: 980 },
  { time: '12:00', human: 2780, bot: 3908 },
  { time: '16:00', human: 1890, bot: 4800 },
  { time: '20:00', human: 2390, bot: 3800 },
  { time: '24:00', human: 3490, bot: 4300 },
];

const mockRequests = [
  { id: '1', time: '10:42:01', ip: '192.168.1.1', path: '/login', threatType: 'OAT-001 Credential Stuffing', action: 'blocked' as const },
  { id: '2', time: '10:42:05', ip: '203.0.113.4', path: '/api/data', threatType: 'OAT-011 Scraping', action: 'challenged' as const },
  { id: '3', time: '10:42:10', ip: '10.0.0.5', path: '/', action: 'allowed' as const },
];

export default function Overview() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Dashboard Overview</h1>
        <div className="text-sm text-aegis-muted">Last 24 Hours</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard title="Total Requests" value="1.2M" icon={Activity} trend={12} trendLabel="vs last 24h" color="text-blue-400" />
        <StatsCard title="Blocked Bots" value="342K" icon={ShieldAlert} trend={-5} trendLabel="vs last 24h" color="text-red-400" />
        <StatsCard title="Human Traffic" value="71.5%" icon={Users} trend={2.4} trendLabel="vs last 24h" color="text-green-400" />
        <StatsCard title="Avg Latency" value="12ms" icon={Zap} trend={-1.2} trendLabel="vs last 24h" color="text-yellow-400" />
      </div>

      <div className="bg-aegis-panel p-6 rounded-lg border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Traffic Analysis</h2>
        <TrafficChart data={mockChartData} />
      </div>

      <div className="bg-aegis-panel p-6 rounded-lg border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Recent Threats</h2>
        <RequestTable requests={mockRequests} />
      </div>
    </div>
  );
}
