import { useMemo } from "react";
import type { WsEvent } from "./types";

type TimelineProps = {
  events: WsEvent[];
};

type EventLabel = {
  icon: string;
  text: string;
};

const MAX_VISIBLE_EVENTS = 50;

function eventLabel(event: WsEvent): EventLabel {
  switch (event.type) {
    case "snapshot":
      return { icon: "📸", text: "Initial state" };

    case "session.created":
      return {
        icon: "🆕",
        text: `Created: ${event.session?.task?.slice(0, 60) ?? "Unknown task"}`,
      };

    case "session.status":
      return {
        icon: "🔁",
        text: `Status → ${event.session?.status ?? "unknown"}`,
      };

    case "session.file_changed":
      return {
        icon: "📄",
        text: `File: ${event.file ?? "unknown file"}`,
      };

    case "session.cost":
      return {
        icon: "💰",
        text: `Cost: +${(event.delta?.cost_usd ?? 0).toFixed(5)}`,
      };

    case "heartbeat":
      return { icon: "💓", text: "Heartbeat" };

    default:
      return { icon: "❓", text: event.type || "unknown" };
  }
}

function eventKey(event: WsEvent, index: number): string {
  return [
    event.type ?? "unknown",
    event.session?.id ?? "no-session",
    event.ts ?? "no-ts",
    event.file ?? "no-file",
    index,
  ].join(":");
}

export function Timeline({ events }: TimelineProps) {
  const recent = useMemo(() => {
    return events.slice(-MAX_VISIBLE_EVENTS).reverse();
  }, [events]);

  if (recent.length === 0) {
    return (
      <div style={{ fontSize: "0.8rem", color: "#555", fontStyle: "italic" }}>
        Waiting for events...
      </div>
    );
  }

  return (
    <div style={{ maxHeight: "400px", overflowY: "auto", fontSize: "0.75rem" }}>
      {recent.map((event, index) => {
        const { icon, text } = eventLabel(event);

        return (
          <div
            key={eventKey(event, index)}
            style={{
              display: "flex",
              gap: "0.3rem",
              padding: "0.15rem 0",
              borderBottom: "1px solid #222",
              color: "#999",
              alignItems: "flex-start",
            }}
          >
            <span style={{ flexShrink: 0 }}>{icon}</span>
            <span
              title={text}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "block",
                minWidth: 0,
                flex: 1,
              }}
            >
              {text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
