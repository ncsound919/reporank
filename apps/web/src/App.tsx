import { BrowserRouter, Routes, Route } from "react-router";
import { AuthProvider } from "./contexts/AuthContext";
import LandingPage from "./pages/LandingPage";
import CallbackPage from "./pages/CallbackPage";
import DashboardPage from "./pages/DashboardPage";
import ScanDetailPage from "./pages/ScanDetailPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth/callback" element={<CallbackPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/scan/:id" element={<ScanDetailPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
