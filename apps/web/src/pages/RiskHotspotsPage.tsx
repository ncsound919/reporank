import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { AlertTriangle, Shield } from "lucide-react";

interface Hotspot {
  repoId: string;
  repoName: string;
  repoUrl: string;
  riskScore: number;
  securityRisk: string;
  qualityScore: number;
  driftStatus: string;
}

const securityColors: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-green-100 text-green-800",
};

const driftColors: Record<string, string> = {
  "on-scope": "text-green-600",
  "at-risk": "text-yellow-600",
  drifting: "text-red-600",
  blocked: "text-red-800",
};

export default function RiskHotspotsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    loadRiskHotspots();
  }, [orgId]);

  const loadRiskHotspots = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/v1/dashboards/org/${orgId}/risk-hotspots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("reporank_token")}` },
      });
      if (!response.ok) throw new Error("Failed to load risk hotspots");
      const data = await response.json();
      setHotspots(data.data.hotspots);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="text-gray-500">Loading risk hotspots...</div></div>;
  if (error) return <div className="flex items-center justify-center h-screen"><div className="text-red-500">{error}</div></div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="text-red-600" />
            Risk Hotspots
          </h1>
          <p className="text-gray-600 mt-2">Repositories ranked by risk score (combination of security, quality, and scope drift)</p>
        </div>

        {hotspots.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500">No repositories with risk data yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {hotspots.map((hotspot, index) => (
              <Link key={hotspot.repoId} to={`/scan/${hotspot.repoId}`}>
                <div className="bg-white rounded-lg shadow hover:shadow-md transition p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-400 text-lg">#{index + 1}</span>
                        <h3 className="text-lg font-semibold text-gray-900">{hotspot.repoName}</h3>
                      </div>
                      <p className="text-sm text-gray-500 truncate">{hotspot.repoUrl}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-red-600">{Math.round(hotspot.riskScore)}</div>
                      <p className="text-xs text-gray-500">Risk Score</p>
                    </div>
                  </div>

                  {/* Risk Gauge */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            hotspot.riskScore < 30
                              ? "bg-green-600"
                              : hotspot.riskScore < 60
                                ? "bg-yellow-600"
                                : "bg-red-600"
                          }`}
                          style={{ width: `${Math.min(100, hotspot.riskScore)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 font-medium">{hotspot.riskScore > 70 ? "Critical" : hotspot.riskScore > 40 ? "High" : "Medium"}</span>
                    </div>
                  </div>

                  {/* Risk Breakdown */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-blue-50 rounded p-3">
                      <p className="text-xs text-gray-600">Quality Score</p>
                      <p className="text-lg font-bold text-blue-700">{hotspot.qualityScore}/100</p>
                    </div>
                    <div className={`rounded p-3 ${securityColors[hotspot.securityRisk] || securityColors.medium}`}>
                      <p className="text-xs opacity-75">Security Risk</p>
                      <p className="text-lg font-bold capitalize">{hotspot.securityRisk}</p>
                    </div>
                    <div className="bg-purple-50 rounded p-3">
                      <p className="text-xs text-gray-600">Drift Status</p>
                      <p className={`text-lg font-bold capitalize ${driftColors[hotspot.driftStatus] || "text-gray-700"}`}>
                        {hotspot.driftStatus}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
