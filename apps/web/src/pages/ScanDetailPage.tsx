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
  const fixPacks = scan?.fixPacks;
  const trending = scan?.trending;
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

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

  const copyToClipboard = async (text: string, idx: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">RepoRank</a>
          <span className="text-sm text-gray-400">{report.repoOwner}/{report.repoName}</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Score header */}
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
              {trending && (
                <span className={trending.direction === "up" ? "text-emerald-400" : trending.direction === "down" ? "text-red-400" : "text-gray-500"}>
                  {trending.direction === "up" ? "▲" : trending.direction === "down" ? "▼" : "◆"} {trending.delta > 0 ? "+" : ""}{trending.delta} from previous scan
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Dimension grid */}
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

        {/* Implementation Plan — THE KEY NEW SECTION */}
        {report.implementationPlan && report.implementationPlan.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4 text-emerald-400">📋 Fix Plan — Step by Step</h3>
            <div className="space-y-4">
              {report.implementationPlan.map((step, i) => (
                <div key={i} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium text-white">{i + 1}. {step.title}</h4>
                    <button onClick={() => copyToClipboard(step.promptInstruction, i)}
                      className="text-xs text-emerald-400 hover:text-emerald-300 shrink-0 ml-4">
                      {copiedIdx === i ? "Copied!" : "Copy Prompt"}
                    </button>
                  </div>
                  <p className="text-sm text-gray-400 mb-2">{step.description}</p>
                  {step.targetFiles && step.targetFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {step.targetFiles.map((f, j) => (
                        <span key={j} className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded font-mono">{f}</span>
                      ))}
                    </div>
                  )}
                  <div className="bg-gray-950 rounded p-3 mt-2">
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">{step.promptInstruction}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fix Packs */}
        {fixPacks && fixPacks.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4 text-blue-400">📦 Auto-Generated Fix Patches</h3>
            <div className="space-y-4">
              {fixPacks.map((fp, i) => (
                <div key={i} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="text-xs text-gray-500 font-mono">{fp.filePath}</span>
                      <h4 className="font-medium text-white">{fp.title}</h4>
                    </div>
                    <button onClick={() => copyToClipboard(fp.content || "", i + 100)}
                      className="text-xs text-blue-400 hover:text-blue-300 shrink-0 ml-4">
                      {copiedIdx === i + 100 ? "Copied!" : "Copy Patch"}
                    </button>
                  </div>
                  <p className="text-sm text-gray-400 mb-2">{fp.description}</p>
                  {fp.content && (
                    <pre className="bg-gray-950 rounded p-3 text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto max-h-48">
                      {fp.content}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Wins with Action + FilePath */}
        {report.quickWins.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4">⚡ Quick Wins</h3>
            <div className="space-y-3">
              {report.quickWins.map((w, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-lg">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border shrink-0 ${
                    w.severity === "critical" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                    w.severity === "high" ? "bg-orange-500/20 text-orange-400 border-orange-500/30" :
                    w.severity === "medium" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                    "bg-blue-500/20 text-blue-400 border-blue-500/30"}`}>{w.severity.toUpperCase()}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{w.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{w.description}</p>
                    {w.action && <p className="text-xs text-emerald-400 mt-1 font-mono">{w.action}</p>}
                    <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-600">
                      <span>Effort: {w.effort}</span>
                      <span>Category: {w.category}</span>
                      {w.filePath && <span className="font-mono">File: {w.filePath}</span>}
                    </div>
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

        {/* Hallucinated features */}
        {report.hallucinatedFeatures.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4 text-orange-400">🌀 Hallucinated Features</h3>
            {report.hallucinatedFeatures.map((h, i) => (
              <p key={i} className="text-sm text-gray-400 mb-1">• {h}</p>
            ))}
          </div>
        )}

        {/* Structural smells */}
        {report.structuralSmells.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4 text-yellow-400">👃 Structural Smells</h3>
            {report.structuralSmells.map((s, i) => (
              <p key={i} className="text-sm text-gray-400 mb-1">• {s}</p>
            ))}
          </div>
        )}

        {/* Bugs & Leaks */}
        {report.bugsAndLeaks.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
            <h3 className="text-lg font-semibold mb-4 text-red-400">🐛 Bugs & Leaks</h3>
            {report.bugsAndLeaks.map((b, i) => (
              <p key={i} className="text-sm text-gray-400 mb-1 font-mono">• {b}</p>
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
