export interface AgentSession {
  id: string;
  task: string;
  status: "pending" | "running" | "blocked" | "done" | "failed";
  model: string;
  model_provider: string;
  files_changed: string[];
  started_at: number;
  ended_at: number | null;
  duration_ms: number;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  parent_session: string | null;
}

export interface WsEvent {
  type: "snapshot" | "session.created" | "session.status" | "session.file_changed" | "session.cost" | "heartbeat";
  ts: number;
  session?: AgentSession | null;
  file?: string;
  delta?: {
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  };
  message?: string;
}
