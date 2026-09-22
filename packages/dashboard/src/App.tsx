import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import Overview from './pages/Overview';
import Analytics from './pages/Analytics';
import Threats from './pages/Threats';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import MLPerformance from './pages/MLPerformance';

const App: React.FC = () => {
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  
  const toggleTheme = () => setIsDarkTheme(!isDarkTheme);

  const themeStyle = {
    backgroundColor: isDarkTheme ? '#121212' : '#f5f5f5',
    color: isDarkTheme ? '#ffffff' : '#000000',
    minHeight: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  };

  return (
    <div style={themeStyle}>
      <BrowserRouter>
        <DashboardLayout isDarkTheme={isDarkTheme} toggleTheme={toggleTheme}>
          <Routes>
            <Route path="/" element={<Overview isDarkTheme={isDarkTheme} />} />
            <Route path="/analytics" element={<Analytics isDarkTheme={isDarkTheme} />} />
            <Route path="/threats" element={<Threats isDarkTheme={isDarkTheme} />} />
            <Route path="/logs" element={<Logs isDarkTheme={isDarkTheme} />} />
            <Route path="/ml-performance" element={<MLPerformance isDarkTheme={isDarkTheme} />} />
            <Route path="/settings" element={<Settings isDarkTheme={isDarkTheme} />} />
          </Routes>
        </DashboardLayout>
      </BrowserRouter>
    </div>
  );
};

export default App;
