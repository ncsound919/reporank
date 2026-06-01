import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api } from "../api/client";
import type { ScanResult } from "../api/client";
import ScoreGauge from "../components/ScoreGauge";
import ScoreBreakdown from "../components/ScoreBreakdown";
import VibeBreakdown from "../components/VibeBreakdown";
import SecuritySection from "../components/SecuritySection";

export default function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = scan?.result;

  useEffect(() => {
    if (!id) return;
    const poll = setInterval(async () => {
      try {
        const s = await api.scans.get(id);
        setScan(s);
        if (s.status === "complete" || s.status === "error") clearInterval(poll);
      } catch (err: any) { setError(err.message); clearInterval(poll); }
    }, 2000);
    return () => clearInterval(poll);
  }, [id]);

  if (error) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-red-400">{error}</p></div>;
  if (!scan) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading scan...</p></div>;
  if (scan.status !== "complete" || !report) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-400 text-lg mb-2">{scan.message || scan.status}</p>
        <div className="h-2 w-64 bg-gray-800 rounded-full overflow-hidden mx-auto">
          <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${scan.progress}%` }} />
        </div>
        <p className="text-gray-500 text-sm mt-2">{scan.progress}%</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">RepoRank</a>
          <span className="text-sm text-gray-400">{report.repoOwner}/{report.repoName}</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Top section: score gauge + maturity + grade */}
        <div className="flex flex-col md:flex-row gap-8 mb-8">
          <div className="relative flex items-center justify-center">
            <ScoreGauge score={report.overallScore} size={200} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-4 mb-2">
              <span className="text-4xl font-bold">{report.overallScore}/100</span>
              <span className={`px-3 py-1 rounded-lg text-lg font-bold ${
                report.gradeCategory === "A" || report.gradeCategory === "A+" ? "bg-emerald-500/20 text-emerald-400" :
                report.gradeCategory === "B" || report.gradeCategory === "B+" ? "bg-blue-500/20 text-blue-400" :
                report.gradeCategory === "C" ? "bg-yellow-500/20 text-yellow-400" :
                "bg-red-500/20 text-red-400"}`}>{report.gradeCategory}</span>
              <span className="text-sm text-gray-500">{report.maturityLevel}</span>
            </div>
            <p className="text-gray-400 text-sm mb-4">{report.summary}</p>
            <div className="flex gap-4 text-sm text-gray-500">
              <span>📁 {report.architecture.fileCount} files</span>
              <span>⭐ {report.starsCount} stars</span>
              <span>🔀 {report.forksCount} forks</span>
            </div>
          </div>
        </div>

        {/* Dimension breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Score Breakdown</h3>
            <ScoreBreakdown dimensions={report.dimensionScores} />
          </div>
          <SecuritySection security={report.security} />
        </div>

        {/* Vibe + Architecture */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <VibeBreakdown vibe={report.vibe} />
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Architecture</h3>
            <div className="space-y-3">
              {[
                { label: "Coupling", score: report.architecture.couplingScore, color: "#f59e0b" },
                { label: "Complexity", score: report.architecture.score, color: "#f59e0b" },
                { label: "Deployment", score: report.deployment.score, color: "#06b6d4" },
                { label: "Documentation", score: report.documentation.score, color: "#ec4899" },
                { label: "License", score: report.license.score, color: "#14b8a6" },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-gray-400">{item.label}</span>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${item.score}%`, backgroundColor: item.color }} />
                  </div>
                  <span className="w-8 text-right text-sm text-gray-300">{item.score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Wins */}
        {report.quickWins.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4">⚡ Quick Wins</h3>
            <div className="space-y-3">
              {report.quickWins.map((w, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-lg">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                    w.severity === "critical" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                    w.severity === "high" ? "bg-orange-500/20 text-orange-400 border-orange-500/30" :
                    w.severity === "medium" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                    "bg-blue-500/20 text-blue-400 border-blue-500/30"}`}>{w.severity.toUpperCase()}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{w.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{w.description}</p>
                    <p className="text-xs text-gray-600 mt-1">Effort: {w.effort} | Category: {w.category}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Roadmap */}
        {report.roadmap.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4">🗺️ Build Roadmap</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {["now", "next", "later"].map(phase => (
                <div key={phase}>
                  <h4 className={`text-sm font-semibold uppercase mb-3 ${
                    phase === "now" ? "text-red-400" : phase === "next" ? "text-yellow-400" : "text-gray-400"}`}>{phase}</h4>
                  <div className="space-y-2">
                    {report.roadmap.filter(r => r.phase === phase).map((r, i) => (
                      <div key={i} className="bg-gray-800/50 rounded-lg p-3">
                        <p className="text-sm">{r.task}</p>
                        <p className="text-xs text-gray-500 mt-1">{r.category} · {r.effort}</p>
                      </div>
                    ))}
                    {report.roadmap.filter(r => r.phase === phase).length === 0 && (
                      <p className="text-xs text-gray-600 italic">No items</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hallucinated features + bugs */}
        {report.hallucinatedFeatures.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4 text-orange-400">🌀 Hallucinated Features</h3>
            {report.hallucinatedFeatures.map((h, i) => (
              <p key={i} className="text-sm text-gray-400 mb-1">• {h}</p>
            ))}
          </div>
        )}

        {report.bugsAndLeaks.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4 text-red-400">🐛 Bugs & Leaks</h3>
            {report.bugsAndLeaks.map((b, i) => (
              <p key={i} className="text-sm text-gray-400 mb-1">• {b}</p>
            ))}
          </div>
        )}

        {scan.duration && (
          <p className="text-center text-sm text-gray-600">Scan completed in {scan.duration}s</p>
        )}
      </main>
    </div>
  );
}
