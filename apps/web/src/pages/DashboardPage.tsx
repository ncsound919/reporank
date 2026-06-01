import { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";

export default function DashboardPage() {
  const { user, login } = useAuth();
  const [repoUrl, setRepoUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (user) api.scans.list().then(setHistory).catch(() => {});
  }, [user]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { login(); return; }
    setError(null); setStatus("Submitting scan..."); setProgress(0);

    try {
      const result = await api.scans.submit(repoUrl);
      setStatus("Scan queued...");
      setProgress(10);

      pollRef.current = setInterval(async () => {
        try {
          const scan = await api.scans.get(result.scanId);
          setProgress(scan.progress);
          setStatus(scan.message || scan.status);

          if (scan.status === "complete") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus("Complete!");
            setProgress(100);
            setTimeout(() => window.location.href = `/scan/${result.scanId}`, 1000);
          }
          if (scan.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(scan.error || "Scan failed");
            setStatus("Failed");
          }
        } catch (err: any) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(err.message);
        }
      }, 2000);
    } catch (err: any) {
      setError(err.message);
      setStatus("Error");
    }
  };

  const barColor = progress >= 80 ? "bg-emerald-500" : progress >= 50 ? "bg-yellow-500" : "bg-blue-500";

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="text-lg font-bold">RepoRank</a>
          <div className="flex items-center gap-4">
            {user && <span className="text-sm text-gray-400">{user.displayName}</span>}
            {!user && <button onClick={login} className="bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-lg font-medium text-sm">Sign In</button>}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-12">
        <h1 className="text-3xl font-bold mb-2">Grade a Repository</h1>
        <p className="text-gray-400 mb-8">Enter a GitHub URL to analyze its codebase across 8 dimensions.</p>

        <form onSubmit={handleSubmit} className="flex gap-3 mb-8">
          <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="flex-1 bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50" />
          <button type="submit" disabled={!!status && status !== "Failed" && status !== "Error"}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-700 text-black disabled:text-gray-500 font-semibold px-6 py-3 rounded-xl transition-colors">
            {!user ? "Sign In & Grade" : "Grade It"}
          </button>
        </form>

        {status && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-300">{status}</span>
              <span className="text-sm text-gray-500">{progress}%</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${progress}%` }} />
            </div>
            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          </div>
        )}

        {history.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Recent Scans</h2>
            <div className="space-y-2">
              {history.map((scan: any) => (
                <a key={scan.id} href={`/scan/${scan.id}`}
                  className="block bg-gray-900 rounded-lg p-4 border border-gray-800 hover:border-gray-700 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{scan.repoOwner}/{scan.repoName}</p>
                      <p className="text-xs text-gray-500">{scan.status}</p>
                    </div>
                    {scan.overallScore != null && (
                      <span className={`text-lg font-bold ${scan.overallScore >= 80 ? "text-emerald-400" : scan.overallScore >= 60 ? "text-yellow-400" : "text-red-400"}`}>
                        {scan.overallScore}/100
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
