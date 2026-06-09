import { useState, useCallback, useRef } from "react";
import type { WsEvent, AgentSession } from "./types";
import { useAgentWebSocket } from "./useWebSocket";
import { AgentCard } from "./AgentCard";
import { DispatchForm } from "./DispatchForm";
import { Timeline } from "./Timeline";
import { CostPanel } from "./CostPanel";

const API_BASE = "http://127.0.0.1:8000";
const API_KEY = "benchmark-secret-2024";

function httpReq(method: string, path: string, body?: unknown) {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-VibeServe-API-Key": API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

export default function App() {
  const [sessions, setSessions] = useState<Map<string, AgentSession>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<WsEvent[]>([]);
  const [approvalMode, setApprovalMode] = useState(false);
  const [pendingDeploys, setPendingDeploys] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionMapRef = useRef(new Map<string, AgentSession>());

  const onEvent = useCallback((event: WsEvent, map: Map<string, AgentSession>) => {
    sessionMapRef.current = map;
    setSessions(new Map(map));
    if (event.session?.id && (event.type !== "snapshot" || event.session)) {
      setTimeline((prev) => [...prev.slice(-199), event]);
    }
  }, []);

  useAgentWebSocket(onEvent);

  const sorted = [...sessions.values()].sort((a, b) => b.started_at - a.started_at);

  const dispatchAgent = async (task: string, model: string) => {
    setError(null);
    try {
      const session = await httpReq("POST", "/v1/agents", { task, model });
      if (approvalMode) {
        setPendingDeploys((prev) => [...prev, session]);
      }
    } catch (e) {
      setError(`Dispatch failed: ${(e as Error).message}`);
    }
  };

  const killSession = async (id: string) => {
    setError(null);
    try {
      await httpReq("POST", `/v1/agents/${id}:update`, { status: "failed", ended_at: "now" });
    } catch (e) {
      setError(`Kill failed: ${(e as Error).message}`);
    }
  };

  const approveDeploy = (session: AgentSession) => {
    httpReq("POST", `/v1/agents/${session.id}:update`, { status: "running" }).catch(() => {});
    setPendingDeploys((prev) => prev.filter((s) => s.id !== session.id));
  };

  const rejectDeploy = (session: AgentSession) => {
    httpReq("POST", `/v1/agents/${session.id}:update`, { status: "failed", ended_at: "now" }).catch(() => {});
    setPendingDeploys((prev) => prev.filter((s) => s.id !== session.id));
  };

  const totalCost = sorted.reduce((s, a) => s + a.cost_usd, 0);
  const runningCount = sorted.filter((s) => s.status === "running").length;
  const failedCount = sorted.filter((s) => s.status === "failed").length;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: "1400px", margin: "0 auto", color: "#e0e0e0", background: "#111", minHeight: "100vh" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem", borderBottom: "1px solid #333", paddingBottom: "0.75rem" }}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 600, margin: 0 }}>🤖 Agent Orchestrator</h1>
        <span style={{ fontSize: "0.8rem", color: "#888" }}>{sorted.length} sessions</span>
        <span style={{ fontSize: "0.8rem", color: runningCount > 0 ? "#4caf50" : "#888" }}>
          {runningCount} running
        </span>
        <span style={{ fontSize: "0.8rem", color: failedCount > 0 ? "#f44336" : "#888" }}>
          {failedCount} failed
        </span>
        <span style={{ fontSize: "0.8rem", color: "#888" }}>${totalCost.toFixed(4)} total</span>
        <label style={{ marginLeft: "auto", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
          <input type="checkbox" checked={approvalMode} onChange={(e) => setApprovalMode(e.target.checked)} />
          Approval mode
        </label>
      </header>

      {error && (
        <div style={{ background: "#d32f2f22", border: "1px solid #d32f2f", borderRadius: "6px", padding: "0.5rem 1rem", marginBottom: "1rem", fontSize: "0.85rem" }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: "1rem", background: "none", border: "none", color: "#aaa", cursor: "pointer" }}>✕</button>
        </div>
      )}

      <DispatchForm onDispatch={dispatchAgent} />

      {approvalMode && pendingDeploys.length > 0 && (
        <div style={{ background: "#2d1b00", border: "1px solid #ff9800", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
          <strong style={{ color: "#ff9800", fontSize: "0.85rem" }}>⏳ Pending Approval ({pendingDeploys.length})</strong>
          {pendingDeploys.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem" }}>
              <code style={{ color: "#ccc", fontSize: "0.8rem" }}>{s.id.slice(0, 12)}</code>
              <span>{s.task.slice(0, 60)}</span>
              <button onClick={() => approveDeploy(s)} style={{ background: "#388e3c", color: "#fff", border: "none", borderRadius: "4px", padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.75rem" }}>Approve</button>
              <button onClick={() => rejectDeploy(s)} style={{ background: "#d32f2f", color: "#fff", border: "none", borderRadius: "4px", padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.75rem" }}>Reject</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "1rem" }}>
        <div>
          {sorted.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem", color: "#555", fontSize: "0.9rem" }}>
              No agent sessions. Use the form above to dispatch an agent, or connect to the WebSocket to watch running agents.
            </div>
          )}
          {sorted.map((s) => (
            <AgentCard
              key={s.id}
              session={s}
              selected={selectedId === s.id}
              onSelect={() => setSelectedId(selectedId === s.id ? null : s.id)}
              onKill={() => killSession(s.id)}
            />
          ))}
        </div>
        <div>
          <CostPanel sessions={sorted} />
          <div style={{ marginTop: "0.75rem" }}>
            <h3 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem", color: "#888" }}>Recent Events</h3>
            <Timeline events={timeline} />
          </div>
        </div>
      </div>
    </div>
  );
}
