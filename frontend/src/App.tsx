import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import DataManager from "./pages/DataManager";
import StockDetail from "./pages/StockDetail";
import MacroDetail from "./pages/MacroDetail";
import BacktestRun from "./pages/BacktestRun";
import BacktestResult from "./pages/BacktestResult";
import Industry from "./pages/Industry";
import Report from "./pages/Report";
import IndustryDetail from "./pages/IndustryDetail";
import Screener from "./pages/Screener";
import Strategies from "./pages/Strategies";
import Signals from "./pages/Signals";
import Portfolio from "./pages/Portfolio";
import ErrorBoundary from "./components/ErrorBoundary";

const navStyle: React.CSSProperties = {
  color: "#94a3b8",
  textDecoration: "none",
  padding: "8px 16px",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
};

const activeStyle: React.CSSProperties = {
  ...navStyle,
  color: "#e2e8f0",
  background: "#334155",
};

function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: "100vh", background: "#0f172a" }}>
        {/* Nav */}
        <nav
          style={{
            background: "#1e1e2e",
            borderBottom: "1px solid #334155",
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: "#3b82f6", fontWeight: 700, fontSize: 16, marginRight: 24 }}>
            BacktestLab
          </span>
          <NavLink to="/" style={({ isActive }) => (isActive ? activeStyle : navStyle)} end>
            Dashboard
          </NavLink>
          <NavLink to="/data" style={({ isActive }) => (isActive ? activeStyle : navStyle)}>
            Data
          </NavLink>
          <NavLink to="/backtest" style={({ isActive }) => (isActive ? activeStyle : navStyle)}>
            Backtest
          </NavLink>
          <NavLink to="/strategies" style={({ isActive }) => (isActive ? activeStyle : navStyle)}>
            Strategy
          </NavLink>
          <NavLink to="/portfolio" style={({ isActive }) => (isActive ? activeStyle : navStyle)}>
            Portfolio
          </NavLink>
          <NavLink to="/signals" style={({ isActive }) => (isActive ? activeStyle : navStyle)}>
            Signals
          </NavLink>
          <NavLink to="/screener" style={({ isActive }) => (isActive ? activeStyle : navStyle)}>
            Screener
          </NavLink>
          <NavLink to="/industry" style={({ isActive }) => (isActive ? activeStyle : navStyle)}>
            Industry
          </NavLink>
          <NavLink to="/report" style={({ isActive }) => (isActive ? activeStyle : navStyle)}>
            Report
          </NavLink>
        </nav>

        {/* Content */}
        <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/data" element={<DataManager />} />
              <Route path="/data/macro/:seriesId" element={<MacroDetail />} />
              <Route path="/data/:ticker" element={<StockDetail />} />
              <Route path="/backtest" element={<BacktestRun />} />
              <Route path="/results/:id" element={<BacktestResult />} />
              <Route path="/strategies" element={<Strategies />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/signals" element={<Signals />} />
              <Route path="/screener" element={<Screener />} />
              <Route path="/industry" element={<Industry />} />
              <Route path="/industry/:key" element={<IndustryDetail />} />
              <Route path="/industry/:key/:group" element={<IndustryDetail />} />
              <Route path="/report" element={<Report />} />
              <Route path="/report/:universe/:period" element={<Report />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
