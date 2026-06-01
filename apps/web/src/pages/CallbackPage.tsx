import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";

export default function CallbackPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("Authenticating...");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const savedState = localStorage.getItem("reporank_oauth_state");

    if (!code) { setStatus("No authorization code received."); return; }
    if (state && savedState && state !== savedState) { setStatus("OAuth state mismatch. Try again."); return; }

    localStorage.removeItem("reporank_oauth_state");

    api.auth.github(code).then((data) => {
      localStorage.setItem("reporank_token", data.token);
      window.location.href = "/dashboard";
    }).catch((err) => {
      setStatus(`Authentication failed: ${err.message}`);
    });
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400 text-lg">{status}</p>
    </div>
  );
}
