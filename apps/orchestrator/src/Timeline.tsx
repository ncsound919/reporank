import type { WsEvent } from "./types";

function eventLabel(e: WsEvent): { icon: string; text: string } {
  switch (e.type) {
    case "snapshot": return { icon: "📸", text: "Initial state" };
    case "session.created": return { icon: "🆕", text: `Created: ${e.session?.task?.slice(0, 60)}` };
    case "session.status": return { icon: "🔁", text: `Status → ${e.session?.status}` };
    case "session.file_changed": return { icon: "📄", text: `File: ${e.file}` };
    case "session.cost": return { icon: "💰", text: `Cost: +${e.delta?.cost_usd?.toFixed(5)}` };
    case "heartbeat": return { icon: "💓", text: "Heartbeat" };
    default: return { icon: "❓", text: e.type };
  }
}

export function Timeline({ events }: { events: WsEvent[] }) {
  const recent = events.slice(-50).reverse();

  if (recent.length === 0) {
    return (
      <div style={{ fontSize: "0.8rem", color: "#555", fontStyle: "italic" }}>
        Waiting for events...
      </div>
    );
  }

  return (
    <div style={{ maxHeight: "400px", overflowY: "auto", fontSize: "0.75rem" }}>
      {recent.map((e, i) => {
        const { icon, text } = eventLabel(e);
        return (
          <div
            key={`${e.session?.id ?? ""}-${e.ts}-${i}`}
            style={{
              display: "flex",
              gap: "0.3rem",
              padding: "0.15rem 0",
              borderBottom: "1px solid #222",
              color: "#999",
            }}
          >
            <span>{icon}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
