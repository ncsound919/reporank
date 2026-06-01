import type { DimensionScores } from "@reporank/shared-types";

const CONFIG: Record<keyof DimensionScores, { label: string; color: string }> = {
  security: { label: "Security", color: "#10b981" }, quality: { label: "Quality", color: "#3b82f6" },
  vibe: { label: "Vibe", color: "#8b5cf6" }, architecture: { label: "Architecture", color: "#f59e0b" },
  deployment: { label: "Deploy", color: "#06b6d4" }, documentation: { label: "Docs", color: "#ec4899" },
  license: { label: "License", color: "#14b8a6" }, market: { label: "Market", color: "#f97316" },
};

export default function ScoreBreakdown({ dimensions }: { dimensions: DimensionScores }) {
  return (
    <div className="space-y-3">
      {(Object.entries(CONFIG) as [keyof DimensionScores, typeof CONFIG[keyof DimensionScores]][]).map(([key, c]) => (
        <div key={key} className="flex items-center gap-3">
          <span className="w-20 text-sm text-gray-400">{c.label}</span>
          <div className="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${dimensions[key]}%`, backgroundColor: c.color }} />
          </div>
          <span className="w-8 text-right text-sm text-gray-300">{dimensions[key]}</span>
        </div>
      ))}
    </div>
  );
}
