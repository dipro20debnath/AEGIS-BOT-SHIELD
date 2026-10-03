import React from 'react';
import StatsCard from '../components/StatsCard';
import TrafficChart from '../components/TrafficChart';
import RequestTable from '../components/RequestTable';
import ApiStatus from '../components/ApiStatus';
import LiveIndicator from '../components/LiveIndicator';
import { useLiveStats } from '../api';
import { Theme, cardStyle } from '../theme';

const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '—');

const Overview: React.FC<{ theme: Theme }> = ({ theme }) => {
  const live = useLiveStats();
  const s = live.summary;
  const recent = live.events;
  const meanScore = recent.length ? (recent.reduce((a, e) => a + e.score, 0) / recent.length).toFixed(1) : '—';

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ marginTop: 0 }}>Overview</h1>
        <LiveIndicator status={live.status} theme={theme} />
      </div>
      <ApiStatus loading={live.loading} error={live.error} hasData={!!s} theme={theme} />
      {s && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
            <StatsCard theme={theme} title="Requests analysed" value={s.totalRequests.toLocaleString()}
              detail={`since server start, ${Math.round(s.uptimeSeconds / 60)} min ago`} />
            <StatsCard theme={theme} title="Blocked" value={s.blocked.toLocaleString()} detail={pct(s.blocked, s.totalRequests)} />
            <StatsCard theme={theme} title="Challenged" value={s.challenged.toLocaleString()} detail={pct(s.challenged, s.totalRequests)} />
            <StatsCard theme={theme} title="Mean risk score" value={meanScore} detail={`last ${recent.length} requests`} />
            <StatsCard theme={theme} title="Telemetry reports" value={s.telemetrySubmissions.toLocaleString()} detail="from the browser SDK" />
          </div>
          <div style={cardStyle(theme)}>
            <h3 style={{ marginTop: 0 }}>Requests per minute by verdict</h3>
            <TrafficChart events={recent} theme={theme} />
          </div>
          <div style={cardStyle(theme)}>
            <h3 style={{ marginTop: 0 }}>Latest blocked or challenged requests</h3>
            <RequestTable theme={theme} events={recent.filter(e => e.verdict === 'block' || e.verdict === 'challenge').slice(0, 10)} />
          </div>
        </>
      )}
    </div>
  );
};

export default Overview;
