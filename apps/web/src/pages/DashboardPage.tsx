import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";

export default function DashboardPage() {
  const { user, login } = useAuth();
  const [searchParams] = useSearchParams();
  const [repoUrl, setRepoUrl] = useState(searchParams.get("url") || "");
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [privateMode, setPrivateMode] = useState(false);
  const [localFiles, setLocalFiles] = useState<{ path: string; content: string }[]>([]);
  const [folderName, setFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (user) api.scans.list().then(setHistory).catch(() => {});
  }, [user]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleFolderPick = async () => {
    try {
      // Use the file picker API
      const input = document.createElement("input");
      input.type = "file";
      (input as any).webkitdirectory = true;
      (input as any).directory = true;

      input.onchange = async () => {
        const files = Array.from(input.files || []);
        const contents: { path: string; content: string }[] = [];
        let name = "";

        for (const file of files) {
          const path = (file as any).webkitRelativePath || file.name;
          if (!name) name = path.split("/")[0];
          const text = await file.text();
          if (text.length < 500000) { // Skip files >500KB
            contents.push({ path, content: text });
          }
        }

        setLocalFiles(contents);
        setFolderName(name);
      };

      input.click();
    } catch (e: any) {
      setError(`Folder picker not supported: ${e.message}. Use Chrome or Edge.`);
    }
  };

  const startScanPoll = (scanId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const scan = await api.scans.get(scanId);
        setProgress(scan.progress);
        setStatus(scan.message || scan.status);
        if (scan.status === "complete") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("Complete!"); setProgress(100);
          setTimeout(() => window.location.href = `/scan/${scanId}`, 1000);
        }
        if (scan.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(scan.error || "Scan failed"); setStatus("Failed");
        }
      } catch (err: any) {
        if (pollRef.current) clearInterval(pollRef.current);
        setError(err.message);
      }
    }, 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { login(); return; }
    setError(null); setStatus("Submitting..."); setProgress(0);

    try {
      if (mode === "url") {
        const result = await api.scans.submit(repoUrl);
        setStatus("Scan queued..."); setProgress(10);
        startScanPoll(result.scanId);
      } else {
        // Upload local files
        const token = localStorage.getItem("reporank_token");
        const res = await fetch("/api/v1/scans/local", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ files: localFiles.slice(0, 500), privateMode, repoName: folderName || "local-project" }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setStatus("Processing local files..."); setProgress(10);
        startScanPoll(data.data.scanId);
      }
    } catch (err: any) {
      setError(err.message); setStatus("Error");
    }
  };

  const barColor = progress >= 80 ? "bg-emerald-500" : progress >= 50 ? "bg-yellow-500" : "bg-blue-500";

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="text-lg font-bold">RepoRank</a>
          <div className="flex items-center gap-4">
            <a href="/settings" className="text-sm text-gray-400 hover:text-white">Settings</a>
            {user && <span className="text-sm text-gray-400">{user.displayName}</span>}
            {!user && <button onClick={login} className="bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-lg font-medium text-sm">Sign In</button>}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-12">
        <h1 className="text-3xl font-bold mb-2">Grade a Repository</h1>
        <p className="text-gray-400 mb-8">Analyze any codebase across 8 dimensions.</p>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-6 bg-gray-900 rounded-lg p-1 w-fit border border-gray-800">
          <button onClick={() => setMode("url")} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === "url" ? "bg-emerald-500/20 text-emerald-400" : "text-gray-400 hover:text-white"}`}>GitHub URL</button>
          <button onClick={() => setMode("upload")} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === "upload" ? "bg-emerald-500/20 text-emerald-400" : "text-gray-400 hover:text-white"}`}>Upload Folder</button>
        </div>

        {mode === "url" ? (
          <form onSubmit={handleSubmit} className="flex gap-3 mb-4">
            <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="flex-1 bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50" />
            <button type="submit" disabled={!!status && status !== "Failed" && status !== "Error"}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-700 text-black disabled:text-gray-500 font-semibold px-6 py-3 rounded-xl transition-colors">
              Grade It
            </button>
          </form>
        ) : (
          <div className="mb-4">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-4">
              <h3 className="text-lg font-semibold mb-4">Upload Local Folder</h3>
              <p className="text-sm text-gray-400 mb-4">Select a local project folder to analyze. Files are read client-side and sent to the server for analysis.</p>
              <button onClick={handleFolderPick}
                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-6 py-3 rounded-xl font-medium transition-colors">
                📁 Choose Folder
              </button>
              {folderName && <p className="text-sm text-emerald-400 mt-3">📂 {folderName} — {localFiles.length} files loaded</p>}
            </div>

            {/* Private mode toggle */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={privateMode} onChange={e => setPrivateMode(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500" />
                <div>
                  <p className="text-sm font-medium">🔒 Private Mode</p>
                  <p className="text-xs text-gray-500">No AI grading — deterministic analysis only. Data never leaves your machine.</p>
                </div>
              </label>
            </div>

            <button onClick={handleSubmit} disabled={localFiles.length === 0 || (!!status && status !== "Failed" && status !== "Error")}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-700 text-black disabled:text-gray-500 font-semibold px-6 py-3 rounded-xl transition-colors w-full">
              {localFiles.length === 0 ? "Select a folder first" : `Analyze ${localFiles.length} files`}
            </button>
          </div>
        )}

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
                      <span className={`text-lg font-bold ${scan.overallScore >= 80 ? "text-emerald-400" : scan.overallScore >= 60 ? "text-yellow-400" : "text-red-400"}`}>{scan.overallScore}/100</span>
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
