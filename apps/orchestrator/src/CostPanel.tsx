import { useEffect, useState } from "react";
import type { AgentSession } from "./types";

interface BudgetStatus {
  total_requests: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cost_cents: number;
  max_tokens: number;
  max_cost_cents: number;
  remaining_tokens: number;
  remaining_cost_cents: number;
  exceeded: boolean;
  elapsed_seconds: number;
}

interface BudgetProjections {
  burn_rate_tokens_per_minute: number;
  burn_rate_cost_cents_per_minute: number;
  projected_exhaustion_seconds: number | null;
  suggested_actions: string[];
}

interface BudgetResponse {
  status: string;
  budget: BudgetStatus;
  projections: BudgetProjections;
}

const VIBESERVE_API = "http://127.0.0.1:8000";
const API_KEY = (import.meta as { env?: Record<string, string> }).env?.VITE_VIBESERVE_API_KEY ?? "";

export function CostPanel({ sessions }: { sessions: AgentSession[] }) {
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [projections, setProjections] = useState<BudgetProjections | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch(`${VIBESERVE_API}/v1/llm/budget`, {
          headers: { "X-VibeServe-API-Key": API_KEY },
        });
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
          return;
        }
        const data: BudgetResponse = await r.json();
        if (cancelled) return;
        setBudget(data.budget);
        setProjections(data.projections);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const byModel = new Map<string, { count: number; cost: number; tokens: number }>();
  for (const s of sessions) {
    const key = s.model || "unknown";
    const cur = byModel.get(key) ?? { count: 0, cost: 0, tokens: 0 };
    cur.count++;
    cur.cost += s.cost_usd;
    cur.tokens += s.prompt_tokens + s.completion_tokens;
    byModel.set(key, cur);
  }

  const totalCost = [...byModel.values()].reduce((s, v) => s + v.cost, 0);
  const totalTokens = [...byModel.values()].reduce((s, v) => s + v.tokens, 0);

  return (
    <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: "8px", padding: "0.6rem 0.8rem" }}>
      <h3 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem", color: "#888" }}>Cost Breakdown</h3>

      <div style={{ fontSize: "0.8rem", color: "#ccc", marginBottom: "0.5rem" }}>
        Total: <strong>${totalCost.toFixed(5)}</strong> ({totalTokens.toLocaleString()} tokens)
      </div>

      {[...byModel.entries()].map(([model, data]) => (
        <div key={model} style={{ fontSize: "0.75rem", color: "#999", marginBottom: "0.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{model.replace("opencode/", "")} ({data.count}x)</span>
            <span>${data.cost.toFixed(5)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#666" }}>
            <span>{data.tokens.toLocaleString()} tokens</span>
          </div>
        </div>
      ))}

      {budget && (
        <div style={{ marginTop: "0.6rem", borderTop: "1px solid #2a2a2a", paddingTop: "0.5rem" }}>
          <h4 style={{ fontSize: "0.75rem", margin: "0 0 0.4rem", color: "#666" }}>Budget</h4>
          <div style={{ fontSize: "0.7rem", color: budget.exceeded ? "#f44" : "#888" }}>
            {budget.exceeded ? "⛔ EXCEEDED" : "OK"} — {budget.total_requests} reqs
          </div>
          {budget.max_tokens > 0 && (
            <div style={{ fontSize: "0.7rem", color: "#888" }}>
              Tokens: {budget.total_tokens.toLocaleString()} / {budget.max_tokens.toLocaleString()}
              {" "}({budget.remaining_tokens.toLocaleString()} left)
            </div>
          )}
          {budget.max_cost_cents > 0 && (
            <div style={{ fontSize: "0.7rem", color: "#888" }}>
              Cost: ${(budget.total_cost_cents / 100).toFixed(4)} / ${(budget.max_cost_cents / 100).toFixed(2)}
            </div>
          )}
        </div>
      )}

      {projections && projections.burn_rate_tokens_per_minute > 0 && (
        <div style={{ marginTop: "0.4rem" }}>
          <div style={{ fontSize: "0.7rem", color: "#888" }}>
            Burn: {projections.burn_rate_tokens_per_minute.toFixed(0)} tok/min
          </div>
          {projections.projected_exhaustion_seconds !== null && (
            <div style={{ fontSize: "0.7rem", color: "#fa3" }}>
              Exhausts in: {Math.round(projections.projected_exhaustion_seconds / 60)}m
            </div>
          )}
          {projections.suggested_actions.length > 0 && (
            <div style={{ fontSize: "0.65rem", color: "#aaa", marginTop: "0.25rem" }}>
              {projections.suggested_actions.map((a, i) => (
                <div key={i}>• {a}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ fontSize: "0.7rem", color: "#f44", marginTop: "0.4rem" }}>{error}</div>}
    </div>
  );
}
