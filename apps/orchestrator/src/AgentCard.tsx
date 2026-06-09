import type { AgentSession } from "./types";

function statusColor(status: string): string {
  switch (status) {
    case "running": return "#4caf50";
    case "pending": return "#ff9800";
    case "done": return "#2196f3";
    case "failed": return "#f44336";
    case "blocked": return "#9c27b0";
    default: return "#888";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "running": return "● Running";
    case "pending": return "○ Pending";
    case "done": return "✓ Done";
    case "failed": return "✗ Failed";
    case "blocked": return "⊘ Blocked";
    default: return status;
  }
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

function fmtTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleTimeString();
}

export function AgentCard({
  session,
  selected,
  onSelect,
  onKill,
}: {
  session: AgentSession;
  selected: boolean;
  onSelect: () => void;
  onKill: () => void;
}) {
  const liveDuration = session.status === "running" || session.status === "pending"
    ? Date.now() / 1000 - session.started_at
    : session.duration_ms / 1000;

  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? "#1e3a5f" : "#1a1a1a",
        border: `1px solid ${selected ? "#1976d2" : "#333"}`,
        borderRadius: "8px",
        padding: "0.6rem 0.8rem",
        marginBottom: "0.5rem",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
        <span style={{ color: statusColor(session.status), fontWeight: 600, fontSize: "0.75rem" }}>
          {statusLabel(session.status)}
        </span>
        <code style={{ color: "#666", fontSize: "0.7rem" }}>{session.id.slice(0, 12)}</code>
        <span style={{ color: "#888", fontSize: "0.75rem", marginLeft: "auto" }}>
          {session.status === "running" || session.status === "pending"
            ? `${fmtDuration(Date.now() - session.started_at * 1000)}`
            : `${fmtDuration(session.duration_ms)}`}
        </span>
        {(session.status === "running" || session.status === "pending") && (
          <button
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            style={{ background: "none", border: "1px solid #d32f2f44", color: "#f44336", borderRadius: "4px", padding: "0.15rem 0.4rem", cursor: "pointer", fontSize: "0.7rem" }}
          >
            Kill
          </button>
        )}
      </div>
      <div style={{ fontSize: "0.85rem", color: "#ccc", marginBottom: "0.15rem" }}>
        {session.task.slice(0, 120)}
      </div>
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.7rem", color: "#666" }}>
        <span>{session.model}</span>
        <span>${session.cost_usd.toFixed(5)}</span>
        <span>{session.files_changed.length} file(s)</span>
        <span>{session.prompt_tokens + session.completion_tokens} tokens</span>
      </div>
      {selected && session.files_changed.length > 0 && (
        <div style={{ marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid #333" }}>
          <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.2rem" }}>Files:</div>
          {session.files_changed.map((f) => (
            <div key={f} style={{ fontSize: "0.75rem", color: "#aaa", fontFamily: "monospace" }}>{f}</div>
          ))}
        </div>
      )}
    </div>
  );
}
