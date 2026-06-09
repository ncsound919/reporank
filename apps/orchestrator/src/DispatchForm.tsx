import { useState, type FormEvent } from "react";

const MODELS = [
  "deepseek-v4-flash",
  "opencode/deepseek-v4-flash",
  "opencode/claude-sonnet-4",
  "opencode/claude-opus-4",
];

export function DispatchForm({ onDispatch }: { onDispatch: (task: string, model: string) => void }) {
  const [task, setTask] = useState("");
  const [model, setModel] = useState(MODELS[0]);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!task.trim() || sending) return;
    setSending(true);
    await onDispatch(task.trim(), model);
    setTask("");
    setSending(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        gap: "0.5rem",
        marginBottom: "1rem",
        alignItems: "center",
      }}
    >
      <input
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Task description, e.g. 'refactor auth middleware'"
        style={{
          flex: 1,
          background: "#222",
          border: "1px solid #444",
          borderRadius: "6px",
          padding: "0.5rem 0.75rem",
          color: "#e0e0e0",
          fontSize: "0.85rem",
        }}
      />
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        style={{
          background: "#222",
          border: "1px solid #444",
          borderRadius: "6px",
          padding: "0.5rem 0.5rem",
          color: "#e0e0e0",
          fontSize: "0.8rem",
        }}
      >
        {MODELS.map((m) => (
          <option key={m} value={m}>{m.replace("opencode/", "")}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={sending || !task.trim()}
        style={{
          background: sending ? "#555" : "#1976d2",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          padding: "0.5rem 1rem",
          cursor: sending || !task.trim() ? "default" : "pointer",
          fontSize: "0.85rem",
          opacity: sending || !task.trim() ? 0.5 : 1,
        }}
      >
        {sending ? "Dispatching..." : "Dispatch"}
      </button>
    </form>
  );
}
