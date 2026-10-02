import React, { useMemo, useState } from 'react';
import ApiStatus from '../components/ApiStatus';
import RequestTable from '../components/RequestTable';
import { StatsEvent, toCsv, useApi } from '../api';
import { Theme, cardStyle, VERDICT_ORDER } from '../theme';

const PAGE_SIZE = 50;

const Logs: React.FC<{ theme: Theme }> = ({ theme }) => {
  const events = useApi<StatsEvent[]>('/aegis/events?limit=500');
  const [search, setSearch] = useState('');
  const [verdict, setVerdict] = useState('all');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => (events.data ?? []).filter(e =>
    (verdict === 'all' || e.verdict === verdict)
    && (search === '' || e.path.includes(search) || e.ip.includes(search) || e.reasons.some(r => r.includes(search)))), [events.data, search, verdict]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(filtered)], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `aegis-events-${new Date().toISOString().slice(0, 19)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const input: React.CSSProperties = { padding: 8, borderRadius: 4, border: `1px solid ${theme.border}`, backgroundColor: theme.surface, color: theme.text };

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>Request Logs</h1>
      <ApiStatus loading={events.loading} error={events.error} hasData={!!events.data} theme={theme} />
      <div style={{ ...cardStyle(theme), display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label>Search <input style={{ ...input, width: 260 }} value={search} placeholder="path, IP prefix or signal"
          onChange={e => { setSearch(e.target.value); setPage(0); }} /></label>
        <label>Verdict <select style={input} value={verdict} onChange={e => { setVerdict(e.target.value); setPage(0); }}>
          <option value="all">all</option>
          {VERDICT_ORDER.map(v => <option key={v} value={v}>{v}</option>)}
        </select></label>
        <button style={{ ...input, cursor: 'pointer', marginLeft: 'auto' }} onClick={exportCsv} disabled={filtered.length === 0}>
          Export CSV ({filtered.length})
        </button>
      </div>
      <div style={cardStyle(theme)}>
        <RequestTable theme={theme} events={filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)} />
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', color: theme.textSecondary }}>
          <button style={input} disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <span>Page {current + 1} of {pages}</span>
          <button style={input} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </div>
        <div style={{ color: theme.muted, fontSize: 13, marginTop: 8 }}>
          The server keeps the most recent 500 requests in memory; IPs are truncated to /24 (IPv4) or /48 (IPv6).
        </div>
      </div>
    </div>
  );
};

export default Logs;
