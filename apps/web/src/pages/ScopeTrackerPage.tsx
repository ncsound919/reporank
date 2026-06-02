import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { CheckCircle, AlertCircle, XCircle } from "lucide-react";

interface ScopeSnapshot {
  briefId: string;
  scanId: string | null;
  timestamp: string;
  plannedCount: number;
  implementedCount: number;
  unplannedCount: number;
  uncertainCount: number;
  driftCategories: string[];
  missingItems: string[];
  outOfScopeItems: string[];
  compliancePercent: number;
}

interface ScopeData {
  current: ScopeSnapshot;
  timeline: ScopeSnapshot[];
}

export default function ScopeTrackerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [data, setData] = useState<ScopeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadScopeData();
  }, [projectId]);

  const loadScopeData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/v1/scope-compliance/${projectId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("reporank_token")}` },
      });
      if (!response.ok) throw new Error("Failed to load scope compliance data");
      const result = await response.json();
      setData(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="text-gray-500">Loading scope tracker...</div></div>;
  if (error) return <div className="flex items-center justify-center h-screen"><div className="text-red-500">{error}</div></div>;
  if (!data) return <div className="flex items-center justify-center h-screen"><div className="text-gray-500">No data available</div></div>;

  const { current, timeline } = data;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Scope Compliance Tracker</h1>

        {/* Compliance Overview */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Current Status</h2>
            <div className="text-3xl font-bold text-blue-600">{current.compliancePercent}%</div>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-green-50 rounded p-4">
              <p className="text-green-600 text-sm">✓ Implemented</p>
              <p className="text-2xl font-bold text-green-700">{current.implementedCount}</p>
              <p className="text-xs text-gray-500 mt-1">of {current.plannedCount} planned</p>
            </div>
            <div className="bg-red-50 rounded p-4">
              <p className="text-red-600 text-sm">✗ Missing</p>
              <p className="text-2xl font-bold text-red-700">{current.plannedCount - current.implementedCount}</p>
              <p className="text-xs text-gray-500 mt-1">not yet implemented</p>
            </div>
            <div className="bg-yellow-50 rounded p-4">
              <p className="text-yellow-600 text-sm">? Unplanned</p>
              <p className="text-2xl font-bold text-yellow-700">{current.unplannedCount}</p>
              <p className="text-xs text-gray-500 mt-1">features detected</p>
            </div>
            <div className="bg-blue-50 rounded p-4">
              <p className="text-blue-600 text-sm">→ Drift Status</p>
              <p className="text-lg font-bold text-blue-700">{current.driftCategories[0] || "on-scope"}</p>
            </div>
          </div>

          {/* Compliance bar */}
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-green-600 h-full transition-all"
              style={{ width: `${Math.min(100, current.compliancePercent)}%` }}
            />
          </div>
        </div>

        {/* Missing Planned Items */}
        {current.missingItems.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
            <h3 className="font-semibold text-red-900 mb-4 flex items-center gap-2">
              <XCircle size={20} /> Missing Planned Items ({current.missingItems.length})
            </h3>
            <ul className="space-y-2">
              {current.missingItems.map((item, i) => (
                <li key={i} className="text-red-700 text-sm">
                  • {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Out of Scope Items */}
        {current.outOfScopeItems.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-8">
            <h3 className="font-semibold text-yellow-900 mb-4 flex items-center gap-2">
              <AlertCircle size={20} /> Unplanned Features ({current.outOfScopeItems.length})
            </h3>
            <ul className="space-y-2">
              {current.outOfScopeItems.map((item, i) => (
                <li key={i} className="text-yellow-700 text-sm">
                  • {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Compliance Timeline */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Compliance Over Time</h2>
          <div className="space-y-2">
            {timeline.length === 0 ? (
              <div className="text-gray-500 text-center py-8">No historical data yet</div>
            ) : (
              timeline.map((snapshot, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-200 last:border-b-0">
                  <div className="text-sm">
                    <p className="text-gray-900 font-medium">{new Date(snapshot.timestamp).toLocaleDateString()}</p>
                    <p className="text-gray-500 text-xs">{snapshot.implementedCount}/{snapshot.plannedCount} implemented</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full"
                        style={{ width: `${Math.min(100, snapshot.compliancePercent)}%` }}
                      />
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-gray-900">{snapshot.compliancePercent}%</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
