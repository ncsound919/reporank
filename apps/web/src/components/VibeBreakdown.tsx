import type { VibeScore } from "@reporank/shared-types";

export default function VibeBreakdown({ vibe }: { vibe: VibeScore }) {
  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h3 className="text-lg font-semibold mb-4">Vibe Score <span className="text-2xl font-bold text-purple-400 ml-2">{vibe.overall}</span></h3>
      <div className="space-y-3 mb-4">
        {[
          { label: "Naming", score: vibe.namingScore, color: "#8b5cf6" },
          { label: "Modernity", score: vibe.modernityScore, color: "#a78bfa" },
          { label: "Hygiene", score: vibe.hygieneScore, color: "#c4b5fd" },
          { label: "Config", score: vibe.configCoherence, color: "#ddd6fe" },
          { label: "Deps", score: vibe.dependencyFreshness, color: "#ede9fe" },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="w-20 text-sm text-gray-400">{item.label}</span>
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${item.score}%`, backgroundColor: item.color }} />
            </div>
            <span className="w-8 text-right text-sm text-gray-300">{item.score}</span>
          </div>
        ))}
      </div>
      {vibe.recommendations.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-gray-400">Recommendations</h4>
          {vibe.recommendations.map((r, i) => <p key={i} className="text-sm text-gray-500 flex items-start gap-2"><span className="text-purple-400">•</span>{r}</p>)}
        </div>
      )}
    </div>
  );
}
