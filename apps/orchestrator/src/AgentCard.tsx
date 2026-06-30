import type { MouseEvent } from "react";
import type { AgentSession } from "./types";

type AgentCardProps = {
  session: AgentSession;
  selected: boolean;
  onSelect: () => void;
  onKill: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  running: "#4caf50",
  pending: "#ff9800",
  done: "#2196f3",
  failed: "#f44336",
  blocked: "#9c27b0",
};

const STATUS_LABELS: Record<string, string> = {
  running: "● Running",
  pending: "○ Pending",
  done: "✓ Done",
  failed: "✗ Failed",
  blocked: "⊘ Blocked",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "#888";
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

function fmtTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "Unknown";
  return new Date(epochSeconds * 1000).toLocaleTimeString();
}

function isLiveStatus(status: string): boolean {
  return status === "running" || status === "pending";
}

export function AgentCard({
  session,
  selected,
  onSelect,
  onKill,
}: AgentCardProps) {
  const live = isLiveStatus(session.status);
  const durationMs = live
    ? Math.max(0, Date.now() - session.started_at * 1000)
    : Math.max(0, session.duration_ms);

  const filesChanged = Array.isArray(session.files_changed) ? session.files_changed : [];
  const totalTokens = (session.prompt_tokens ?? 0) + (session.completion_tokens ?? 0);
  const trimmedTask = session.task?.slice(0, 120) ?? "";
  const shortId = session.id?.slice(0, 12) ?? "unknown";

  const handleKill = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onKill();
  };

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        background: selected ? "#1e3a5f" : "#1a1a1a",
        border: `1px solid ${selected ? "#1976d2" : "#333"}`,
        borderRadius: "8px",
        padding: "0.6rem 0.8rem",
        marginBottom: "0.5rem",
        cursor: "pointer",
        transition: "all 0.15s ease",
        outline: "none",
      }}
      aria-pressed={selected}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.25rem",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: statusColor(session.status), fontWeight: 600, fontSize: "0.75rem" }}>
          {statusLabel(session.status)}
        </span>

        <code style={{ color: "#666", fontSize: "0.7rem" }}>{shortId}</code>

        <span style={{ color: "#888", fontSize: "0.75rem" }}>
          Started {fmtTime(session.started_at)}
        </span>

        <span style={{ color: "#888", fontSize: "0.75rem", marginLeft: "auto" }}>
          {fmtDuration(durationMs)}
        </span>

        {live && (
          <button
            onClick={handleKill}
            type="button"
            style={{
              background: "none",
              border: "1px solid #d32f2f44",
              color: "#f44336",
              borderRadius: "4px",
              padding: "0.15rem 0.4rem",
              cursor: "pointer",
              fontSize: "0.7rem",
            }}
          >
            Kill
          </button>
        )}
      </div>

      <div style={{ fontSize: "0.85rem", color: "#ccc", marginBottom: "0.15rem" }}>{trimmedTask}</div>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          fontSize: "0.7rem",
          color: "#666",
          flexWrap: "wrap",
        }}
      >
        <span>{session.model || "unknown-model"}</span>
        <span>${(session.cost_usd ?? 0).toFixed(5)}</span>
        <span>{filesChanged.length} file(s)</span>
        <span>{totalTokens} tokens</span>
      </div>

      {selected && filesChanged.length > 0 && (
        <div style={{ marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid #333" }}>
          <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.2rem" }}>Files:</div>
          {filesChanged.map((file) => (
            <div
              key={file}
              style={{ fontSize: "0.75rem", color: "#aaa", fontFamily: "monospace" }}
            >
              {file}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
