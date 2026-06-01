const API_BASE = "/api/v1";

export interface ApiError { error: string; code?: string; }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("reporank_token");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string> || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    if (res.status === 401) { localStorage.removeItem("reporank_token"); window.location.href = "/"; }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data.data;
}

export interface ScanResult {
  id: string; status: string; progress: number; message: string;
  result?: import("@reporank/shared-types").HealthReport;
  error?: string; createdAt: string; completedAt?: string; duration?: number;
}

export interface ScanSummary {
  id: string; repoUrl: string; repoName: string; status: string;
  overallScore?: number; gradeCategory?: string; maturityLevel?: string;
  vibeScore?: number; createdAt: string; completedAt?: string;
}

export interface UserProfile { id: string; email: string; displayName: string; avatarUrl?: string; tier: string; scansThisMonth: number; }

export const api = {
  auth: {
    github: (code: string) => request<{ token: string; user: UserProfile }>("/auth/github", { method: "POST", body: JSON.stringify({ code }) }),
    me: () => request<UserProfile>("/auth/me"),
  },
  scans: {
    submit: (repoUrl: string) => request<{ scanId: string; status: string; estimatedDuration: number }>("/scans", { method: "POST", body: JSON.stringify({ repoUrl }) }),
    get: (id: string) => request<ScanResult>(`/scans/${id}`),
    list: () => request<ScanSummary[]>("/scans"),
  },
};
