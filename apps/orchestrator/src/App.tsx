import { useCallback, useMemo, useState } from "react";
import type { WsEvent, AgentSession } from "./types";
import { useAgentWebSocket } from "./useWebSocket";
import { AgentCard } from "./AgentCard";
import { DispatchForm } from "./DispatchForm";
import { Timeline } from "./Timeline";
import { CostPanel } from "./CostPanel";

const API_BASE = "http://127.0.0.1:8000";
const API_KEY = "benchmark-secret-2024";
const MAX_TIMELINE_EVENTS = 200;

async function httpReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-VibeServe-API-Key": API_KEY,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export default function App() {
  const [sessions, setSessions] = useState<Map<string, AgentSession>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<WsEvent[]>([]);
  const [approvalMode, setApprovalMode] = useState(false);
  const [pendingDeploys, setPendingDeploys] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onEvent = useCallback((event: WsEvent, map: Map<string, AgentSession>) => {
    setSessions(new Map(map));

    if (event.session?.id) {
      setTimeline((prev) => [...prev.slice(-(MAX_TIMELINE_EVENTS - 1)), event]);
    }
  }, []);

  useAgentWebSocket(onEvent);

  const sorted = useMemo(() => {
    return [...sessions.values()].sort((a, b) => b.started_at - a.started_at);
  }, [sessions]);

  const totalCost = useMemo(() => {
    return sorted.reduce((sum, session) => sum + session.cost_usd, 0);
  }, [sorted]);

  const runningCount = useMemo(() => {
    return sorted.filter((session) => session.status === "running").length;
  }, [sorted]);

  const failedCount = useMemo(() => {
    return sorted.filter((session) => session.status === "failed").length;
  }, [sorted]);

  const dispatchAgent = useCallback(
    async (task: string, model: string) => {
      setError(null);

      try {
        const session = await httpReq<AgentSession>("POST", "/v1/agents", { task, model });

        if (approvalMode) {
          setPendingDeploys((prev) => {
            if (prev.some((item) => item.id === session.id)) return prev;
            return [...prev, session];
          });
        }
      } catch (e) {
        setError(`Dispatch failed: ${(e as Error).message}`);
      }
    },
    [approvalMode],
  );

  const killSession = useCallback(async (id: string) => {
    setError(null);

    try {
      await httpReq<unknown>("POST", `/v1/agents/${id}:update`, {
        status: "failed",
        ended_at: "now",
      });
    } catch (e) {
      setError(`Kill failed: ${(e as Error).message}`);
    }
  }, []);

  const approveDeploy = useCallback(async (session: AgentSession) => {
    setError(null);

    try {
      await httpReq<unknown>("POST", `/v1/agents/${session.id}:update`, { status: "running" });
      setPendingDeploys((prev) => prev.filter((s) => s.id !== session.id));
    } catch (e) {
      setError(`Approve failed: ${(e as Error).message}`);
    }
  }, []);

  const rejectDeploy = useCallback(async (session: AgentSession) => {
    setError(null);

    try {
      await httpReq<unknown>("POST", `/v1/agents/${session.id}:update`, {
        status: "failed",
        ended_at: "now",
      });
      setPendingDeploys((prev) => prev.filter((s) => s.id !== session.id));
    } catch (e) {
      setError(`Reject failed: ${(e as Error).message}`);
    }
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "1.5rem",
        maxWidth: "1400px",
        margin: "0 auto",
        color: "#e0e0e0",
        background: "#111",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "1rem",
          borderBottom: "1px solid #333",
          paddingBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: "1.3rem", fontWeight: 600, margin: 0 }}>🤖 Agent Orchestrator</h1>

        <span style={{ fontSize: "0.8rem", color: "#888" }}>{sorted.length} sessions</span>

        <span style={{ fontSize: "0.8rem", color: runningCount > 0 ? "#4caf50" : "#888" }}>
          {runningCount} running
        </span>

        <span style={{ fontSize: "0.8rem", color: failedCount > 0 ? "#f44336" : "#888" }}>
          {failedCount} failed
        </span>

        <span style={{ fontSize: "0.8rem", color: "#888" }}>${totalCost.toFixed(4)} total</span>

        <label
          style={{
            marginLeft: "auto",
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={approvalMode}
            onChange={(e) => setApprovalMode(e.target.checked)}
          />
          Approval mode
        </label>
      </header>

      {error && (
        <div
          style={{
            background: "#d32f2f22",
            border: "1px solid #d32f2f",
            borderRadius: "6px",
            padding: "0.5rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "#aaa",
              cursor: "pointer",
              fontSize: "1rem",
            }}
            aria-label="Dismiss error"
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      <DispatchForm onDispatch={dispatchAgent} />

      {approvalMode && pendingDeploys.length > 0 && (
        <div
          style={{
            background: "#2d1b00",
            border: "1px solid #ff9800",
            borderRadius: "8px",
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
          }}
        >
          <strong style={{ color: "#ff9800", fontSize: "0.85rem" }}>
            ⏳ Pending Approval ({pendingDeploys.length})
          </strong>

          {pendingDeploys.map((session) => (
            <div
              key={session.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginTop: "0.5rem",
                fontSize: "0.85rem",
                flexWrap: "wrap",
              }}
            >
              <code style={{ color: "#ccc", fontSize: "0.8rem" }}>{session.id.slice(0, 12)}</code>
              <span style={{ flex: 1, minWidth: 0 }}>{session.task.slice(0, 60)}</span>
              <button
                onClick={() => approveDeploy(session)}
                style={{
                  background: "#388e3c",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "0.25rem 0.6rem",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
                type="button"
              >
                Approve
              </button>
              <button
                onClick={() => rejectDeploy(session)}
                style={{
                  background: "#d32f2f",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "0.25rem 0.6rem",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                }}
                type="button"
              >
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "1rem" }}>
        <div>
          {sorted.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem", color: "#555", fontSize: "0.9rem" }}>
              No agent sessions. Use the form above to dispatch an agent, or connect to the WebSocket
              to watch running agents.
            </div>
          )}

          {sorted.map((session) => (
            <AgentCard
              key={session.id}
              session={session}
              selected={selectedId === session.id}
              onSelect={() => toggleSelected(session.id)}
              onKill={() => killSession(session.id)}
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
}
