import type { HealthReport } from "./health-report";

export type ScanStatus = "pending" | "queued" | "cloning" | "scanning" | "grading" | "complete" | "error";

export interface ScanJobRequest {
  repoUrl: string;
  branch?: string;
  deepScan?: boolean;
  webhookUrl?: string;
}

export interface ScanJobResponse {
  scanId: string;
  status: ScanStatus;
  estimatedDuration: number;
}

export interface ScanJobStatus {
  id: string;
  status: ScanStatus;
  progress: number;
  message: string;
  result?: HealthReport;
  error?: string;
  createdAt: string;
  completedAt?: string;
  duration?: number;
}
