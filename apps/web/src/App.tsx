import { BrowserRouter, Routes, Route } from "react-router";
import LandingPage from "./pages/LandingPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/pricing" element={<div className="p-8 text-center text-gray-400">Pricing page coming soon</div>} />
      </Routes>
    </BrowserRouter>
  );
}
