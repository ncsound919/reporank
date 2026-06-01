import type { SecurityScan } from "@reporank/shared-types";
import { ShieldAlert, CheckCircle } from "lucide-react";

export default function SecuritySection({ security }: { security: SecurityScan }) {
  const hasIssues = security.vulnerabilityCount > 0 || security.secretsFound > 0;
  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-emerald-400" />Security</h3>
        <span className={`text-2xl font-bold ${security.score >= 80 ? "text-emerald-400" : security.score >= 60 ? "text-yellow-400" : "text-red-400"}`}>{security.score}</span>
      </div>
      {hasIssues ? (
        <div className="space-y-2">
          {security.secretsFound > 0 && <p className="text-red-400 text-sm">{security.secretsFound} secrets found</p>}
          {security.vulnerabilityCount > 0 && <p className="text-gray-400 text-sm">{security.vulnerabilityCount} vulnerabilities</p>}
          {security.vulnerabilities.slice(0, 3).map((v, i) => (
            <div key={i} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg text-sm">
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${v.severity === "critical" ? "bg-red-500/20 text-red-400" : v.severity === "high" ? "bg-orange-500/20 text-orange-400" : "bg-yellow-500/20 text-yellow-400"}`}>{v.severity.toUpperCase()}</span>
              <span className="text-gray-300">{v.title}</span>
            </div>
          ))}
        </div>
      ) : <div className="flex items-center gap-2 text-emerald-400 text-sm"><CheckCircle className="w-4 h-4" />No security issues detected</div>}
    </div>
  );
}
