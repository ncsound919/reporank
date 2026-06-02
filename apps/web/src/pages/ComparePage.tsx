import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api/client";

interface ScanSnapshot {
  id: string; overallScore?: number; gradeCategory?: string; maturityLevel?: string;
  vibeScore?: number; repoName: string; repoOwner: string;
  createdAt: string; duration?: number;
  dimensionScores: Record<string, number>;
  quickWins: { title: string; severity: string; category: string; effort: string }[];
  vibe: { overall: number; namingScore: number; modernityScore: number; hygieneScore: number };
  security: { secretsFound: number; vulnerabilityCount: number; score: number };
}

interface CompareData { scan1: ScanSnapshot; scan2: ScanSnapshot; delta: { overallScore: number | null; dimensions: Record<string, number> } }

export default function ComparePage() {
  const { id1, id2 } = useParams<{ id1: string; id2: string }>();
  const [data, setData] = useState<CompareData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id1 || !id2) return;
    api.compare(id1, id2).then(setData).catch(e => setError(e.message));
  }, [id1, id2]);

  if (error) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">{error}</p></div>;
  if (!data) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading comparison...</p></div>;

  const { scan1, scan2, delta } = data;

  const dimLabels: Record<string, string> = { security: "Security", quality: "Quality", vibe: "Vibe", architecture: "Architecture", deployment: "Deployment", documentation: "Docs", license: "License", market: "Market" };

  const scoreColor = (s?: number) => s != null ? (s >= 80 ? "text-emerald-400" : s >= 60 ? "text-yellow-400" : "text-red-400") : "text-gray-500";
  const deltaColor = (d: number | null) => d == null ? "text-gray-500" : d > 0 ? "text-emerald-400" : d < 0 ? "text-red-400" : "text-gray-500";

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/dashboard" className="text-lg font-bold">RepoRank</Link>
          <span className="text-sm text-gray-400">Compare Scans</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">📊 Scan Comparison</h1>

        {/* Overall Score Comparison */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 text-center">
            <p className="text-sm text-gray-400 mb-2">{scan1.repoOwner}/{scan1.repoName}</p>
            <p className="text-xs text-gray-600 mb-2">{new Date(scan1.createdAt).toLocaleDateString()}</p>
            <p className={`text-4xl font-bold ${scoreColor(scan1.overallScore)}`}>{scan1.overallScore ?? "—"}</p>
            <p className="text-sm text-gray-500 mt-1">{scan1.gradeCategory || "—"}</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 text-center">
            <p className="text-sm text-gray-400 mb-2">Delta</p>
            <p className={`text-4xl font-bold ${deltaColor(delta.overallScore)}`}>
              {delta.overallScore == null ? "—" : delta.overallScore > 0 ? `+${delta.overallScore}` : delta.overallScore}
            </p>
            <p className="text-sm text-gray-500 mt-1">{delta.overallScore == null ? "" : delta.overallScore > 0 ? "Improved" : delta.overallScore < 0 ? "Declined" : "Unchanged"}</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 text-center">
            <p className="text-sm text-gray-400 mb-2">{scan2.repoOwner}/{scan2.repoName}</p>
            <p className="text-xs text-gray-600 mb-2">{new Date(scan2.createdAt).toLocaleDateString()}</p>
            <p className={`text-4xl font-bold ${scoreColor(scan2.overallScore)}`}>{scan2.overallScore ?? "—"}</p>
            <p className="text-sm text-gray-500 mt-1">{scan2.gradeCategory || "—"}</p>
          </div>
        </div>

        {/* Dimension Comparison */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
          <h2 className="text-lg font-semibold mb-4">Dimension Breakdown</h2>
          <div className="space-y-3">
            {Object.entries(dimLabels).map(([key, label]) => {
              const s1 = scan1.dimensionScores[key] ?? 50;
              const s2 = scan2.dimensionScores[key] ?? 50;
              const diff = delta.dimensions[key] ?? 0;
              return (
                <div key={key} className="grid grid-cols-3 gap-4 items-center">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-400 w-20">{label}</span>
                    <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${s1}%`, backgroundColor: "#3b82f6" }} />
                    </div>
                    <span className="text-sm text-gray-300 w-8 text-right">{s1}</span>
                  </div>
                  <div className="text-center">
                    <span className={`text-sm font-mono ${diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-gray-500"}`}>
                      {diff > 0 ? `+${diff}` : diff}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-400 w-20 text-right order-3">{s2}</span>
                    <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden order-2">
                      <div className="h-full rounded-full" style={{ width: `${s2}%`, backgroundColor: "#8b5cf6" }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick Wins Delta */}
        {scan1.quickWins.length > 0 || scan2.quickWins.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h2 className="text-lg font-semibold mb-4">Quick Wins Delta</h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-400 mb-2">Previous ({scan1.quickWins.length} items)</p>
                {scan1.quickWins.map((w, i) => (
                  <div key={i} className="text-xs text-gray-500 mb-1">• {w.title}</div>
                ))}
                {scan1.quickWins.length === 0 && <p className="text-xs text-gray-600 italic">No items</p>}
              </div>
              <div>
                <p className="text-sm text-gray-400 mb-2">Current ({scan2.quickWins.length} items)</p>
                {scan2.quickWins.map((w, i) => (
                  <div key={i} className="text-xs text-gray-500 mb-1">• {w.title}</div>
                ))}
                {scan2.quickWins.length === 0 && <p className="text-xs text-gray-600 italic">No items</p>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
