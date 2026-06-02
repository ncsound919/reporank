import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { TrendingUp, TrendingDown, AlertCircle, BarChart3 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../api/client";

interface Repo {
  repoId: string;
  repoName: string;
  repoUrl: string;
  buildSource: string;
  latestScore: number;
  latestGrade: string;
  scoreChange: number;
  trend: "improving" | "degrading" | "stable";
  driftStatus: "on-scope" | "at-risk" | "drifting" | "blocked";
  lastScannedAt: string;
  securityRiskLevel: string;
  vibeScore: number;
}

interface OrgStats {
  totalRepos: number;
  avgScore: number;
  byGrade: Record<string, number>;
  byDrift: Record<string, number>;
}

const gradeColors: Record<string, string> = {
  "A+": "bg-green-100 text-green-800",
  A: "bg-green-50 text-green-700",
  "B+": "bg-yellow-50 text-yellow-700",
  B: "bg-yellow-100 text-yellow-800",
  C: "bg-orange-50 text-orange-700",
  D: "bg-orange-100 text-orange-800",
  F: "bg-red-100 text-red-800",
};

const driftColors: Record<string, string> = {
  "on-scope": "bg-green-100 text-green-800",
  "at-risk": "bg-yellow-100 text-yellow-800",
  drifting: "bg-red-50 text-red-700",
  blocked: "bg-red-100 text-red-800",
};

export default function OrgDashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"score" | "trend" | "drift" | "risk">("score");
  const [filterDrift, setFilterDrift] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !user) return;
    loadDashboard();
  }, [orgId, user, sortBy, filterDrift]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/v1/dashboards/org/${orgId}/summary`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("reporank_token")}` },
      });
      if (!response.ok) throw new Error("Failed to load dashboard");
      const data = await response.json();

      let filtered = data.data.repos as Repo[];
      if (filterDrift) {
        filtered = filtered.filter((r) => r.driftStatus === filterDrift);
      }

      if (sortBy === "score") {
        filtered.sort((a, b) => b.latestScore - a.latestScore);
      } else if (sortBy === "trend") {
        filtered.sort((a, b) => b.scoreChange - a.scoreChange);
      } else if (sortBy === "drift") {
        const driftOrder = { "on-scope": 0, "at-risk": 1, drifting: 2, blocked: 3 };
        filtered.sort((a, b) => (driftOrder[a.driftStatus] || 4) - (driftOrder[b.driftStatus] || 4));
      } else if (sortBy === "risk") {
        filtered.sort((a, b) => {
          const riskA = 100 - a.latestScore + (a.driftStatus === "drifting" ? 30 : a.driftStatus === "at-risk" ? 15 : 0);
          const riskB = 100 - b.latestScore + (b.driftStatus === "drifting" ? 30 : b.driftStatus === "at-risk" ? 15 : 0);
          return riskB - riskA;
        });
      }

      setRepos(filtered);
      setStats(data.data.stats);
    } catch (err: any) {
      console.error("Error loading dashboard:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><div className="text-lg text-gray-500">Loading organization dashboard...</div></div>;
  }

  if (!stats) {
    return <div className="flex items-center justify-center h-screen"><div className="text-lg text-red-500">Failed to load dashboard</div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Organization Health Dashboard</h1>

        {/* Stats Overview */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <StatCard title="Total Repos" value={stats.totalRepos} />
          <StatCard title="Avg Score" value={`${stats.avgScore}/100`} />
          <StatCard title="Grade A+" value={stats.byGrade["A+"] || 0} />
          <StatCard title="On-Scope" value={stats.byDrift["on-scope"] || 0} />
        </div>

        {/* Grade & Drift Distribution */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <Card title="Grade Distribution">
            <div className="flex gap-2 flex-wrap">
              {Object.entries(stats.byGrade).map(([grade, count]) => (
                <div key={grade} className="text-center">
                  <div className={`px-3 py-1 rounded text-sm font-semibold ${gradeColors[grade]}`}>{grade}</div>
                  <div className="text-xs text-gray-500 mt-1">{count}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Drift Status">
            <div className="flex gap-2 flex-wrap">
              {Object.entries(stats.byDrift).map(([status, count]) => (
                <div key={status} className="text-center">
                  <div className={`px-3 py-1 rounded text-sm font-semibold ${driftColors[status]}`}>{status}</div>
                  <div className="text-xs text-gray-500 mt-1">{count}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Repository List */}
        <Card title="Repositories">
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setSortBy("score")}
              className={`px-4 py-2 rounded text-sm ${sortBy === "score" ? "bg-blue-100 text-blue-900" : "bg-gray-100 text-gray-700"}`}
            >
              Sort by Score
            </button>
            <button
              onClick={() => setSortBy("trend")}
              className={`px-4 py-2 rounded text-sm ${sortBy === "trend" ? "bg-blue-100 text-blue-900" : "bg-gray-100 text-gray-700"}`}
            >
              Sort by Trend
            </button>
            <button
              onClick={() => setSortBy("drift")}
              className={`px-4 py-2 rounded text-sm ${sortBy === "drift" ? "bg-blue-100 text-blue-900" : "bg-gray-100 text-gray-700"}`}
            >
              Sort by Drift
            </button>
            <button
              onClick={() => setSortBy("risk")}
              className={`px-4 py-2 rounded text-sm ${sortBy === "risk" ? "bg-blue-100 text-blue-900" : "bg-gray-100 text-gray-700"}`}
            >
              Sort by Risk
            </button>
          </div>

          <div className="space-y-2">
            {repos.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No repositories yet</div>
            ) : (
              repos.map((repo) => (
                <Link key={repo.repoId} to={`/scan/${repo.repoId}`} className="block">
                  <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{repo.repoName}</h3>
                        <p className="text-sm text-gray-500">{repo.repoUrl}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className={`inline-block px-3 py-1 rounded text-sm font-semibold ${gradeColors[repo.latestGrade]}`}>
                            {repo.latestGrade}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{repo.latestScore}/100</div>
                        </div>
                        <div className="text-right">
                          <div className={`inline-block px-3 py-1 rounded text-sm font-semibold ${driftColors[repo.driftStatus]}`}>
                            {repo.driftStatus}
                          </div>
                        </div>
                        <div className="text-right">
                          {repo.scoreChange > 0 ? (
                            <div className="flex items-center gap-1 text-green-600">
                              <TrendingUp size={16} />
                              <span className="text-sm">+{repo.scoreChange}</span>
                            </div>
                          ) : repo.scoreChange < 0 ? (
                            <div className="flex items-center gap-1 text-red-600">
                              <TrendingDown size={16} />
                              <span className="text-sm">{repo.scoreChange}</span>
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">→</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-gray-600 text-sm">{title}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}
