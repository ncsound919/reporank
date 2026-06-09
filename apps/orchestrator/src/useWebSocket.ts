import { useEffect, useRef, useCallback } from "react";
import type { WsEvent, AgentSession } from "./types";

const WS_URL = "ws://127.0.0.1:8001/ws/agents";
const API_KEY = "benchmark-secret-2024";

const STORAGE_KEY = "orchestrator_sessions";

function loadPersisted(): Map<string, AgentSession> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    return new Map(JSON.parse(raw));
  } catch {
    return new Map();
  }
}

function persist(sessions: Map<string, AgentSession>) {
  try {
    const entries = [...sessions.entries()].filter(([_, s]) => s.status === "running" || s.status === "pending");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore quota errors */ }
}

export function useAgentWebSocket(
  onEvent: (event: WsEvent, sessions: Map<string, AgentSession>) => void,
) {
  const sessionsRef = useRef(loadPersisted());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(API_KEY);
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as WsEvent;
          const map = sessionsRef.current;

          if (event.session) {
            map.set(event.session.id, event.session);
            persist(map);
          }

          onEvent(event, map);
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (mountedRef.current) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      if (mountedRef.current) {
        reconnectTimer.current = setTimeout(connect, 5000);
      }
    }
  }, [onEvent]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);
}
