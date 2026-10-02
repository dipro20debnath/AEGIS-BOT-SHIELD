import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import Overview from './pages/Overview';
import Analytics from './pages/Analytics';
import Threats from './pages/Threats';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import MLPerformance from './pages/MLPerformance';
import { darkTheme, lightTheme } from './theme';

function initialDark(): boolean {
  try {
    const saved = localStorage.getItem('aegis-theme');
    if (saved) return saved === 'dark';
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

const App: React.FC = () => {
  const [dark, setDark] = useState(initialDark);
  const theme = dark ? darkTheme : lightTheme;

  useEffect(() => {
    document.body.style.backgroundColor = theme.page;
    document.body.style.colorScheme = dark ? 'dark' : 'light';
    try { localStorage.setItem('aegis-theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark, theme.page]);

  return (
    <div style={{ backgroundColor: theme.page, color: theme.text, minHeight: '100vh', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
      <BrowserRouter>
        <DashboardLayout theme={theme} toggleTheme={() => setDark(d => !d)}>
          <Routes>
            <Route path="/" element={<Overview theme={theme} />} />
            <Route path="/analytics" element={<Analytics theme={theme} />} />
            <Route path="/threats" element={<Threats theme={theme} />} />
            <Route path="/logs" element={<Logs theme={theme} />} />
            <Route path="/ml-performance" element={<MLPerformance theme={theme} />} />
            <Route path="/settings" element={<Settings theme={theme} />} />
          </Routes>
        </DashboardLayout>
      </BrowserRouter>
    </div>
  );
};

export default App;
