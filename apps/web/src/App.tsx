import { BrowserRouter, Routes, Route } from "react-router";
import { AuthProvider } from "./contexts/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary";
import LandingPage from "./pages/LandingPage";
import CallbackPage from "./pages/CallbackPage";
import DashboardPage from "./pages/DashboardPage";
import ScanDetailPage from "./pages/ScanDetailPage";
import ComparePage from "./pages/ComparePage";
import SettingsPage from "./pages/SettingsPage";
import OrgDashboard from "./pages/OrgDashboard";
import ScopeTrackerPage from "./pages/ScopeTrackerPage";
import RiskHotspotsPage from "./pages/RiskHotspotsPage";

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth/callback" element={<CallbackPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/org/:orgId/dashboard" element={<OrgDashboard />} />
            <Route path="/org/:orgId/hotspots" element={<RiskHotspotsPage />} />
            <Route path="/scan/:id" element={<ScanDetailPage />} />
            <Route path="/project/:projectId/scope" element={<ScopeTrackerPage />} />
            <Route path="/compare/:id1/:id2" element={<ComparePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
