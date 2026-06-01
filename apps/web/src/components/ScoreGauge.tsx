import { motion } from "motion/react";

function getColor(score: number) { return score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#ef4444"; }

export default function ScoreGauge({ score, size = 160, label }: { score: number; size?: number; label?: string }) {
  const radius = size * 0.4;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} stroke="currentColor" strokeWidth={size*0.08} fill="none" className="text-gray-800" />
        <motion.circle cx={size/2} cy={size/2} r={radius} stroke={getColor(score)} strokeWidth={size*0.08} fill="none" strokeLinecap="round"
          strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: offset }} transition={{ duration: 1 }} />
      </svg>
      <div className="absolute flex flex-col items-center" style={{ width: size, height: size }}>
        <motion.span className="text-3xl font-bold" style={{ color: getColor(score) }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>{score}</motion.span>
      </div>
      {label && <span className="text-sm text-gray-400">{label}</span>}
    </div>
  );
}
