import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";

export default function CallbackPage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const [status, setStatus] = useState("Authenticating...");

  useEffect(() => {
    if (!code) { setStatus("No authorization code received."); return; }

    const savedState = localStorage.getItem("reporank_oauth_state");
    if (state && savedState && state !== savedState) { setStatus("OAuth state mismatch. Try again."); return; }
    localStorage.removeItem("reporank_oauth_state");

    api.auth.github(code).then((data) => {
      localStorage.setItem("reporank_token", data.token);
      window.location.href = "/dashboard";
    }).catch((err) => {
      if (err.message?.includes("Failed to fetch") || err.message?.includes("Unexpected end")) {
        setStatus("Could not reach the API server. Make sure it's running on port 3001.");
      } else {
        setStatus(`Authentication failed: ${err.message}`);
      }
    });
  }, [code, state]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400 text-lg">{status}</p>
    </div>
  );
}
