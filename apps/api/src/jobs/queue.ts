import Bull from "bull";
import { config } from "../config";

export interface ScanJobData {
  scanId: string; repoUrl: string; repoName: string; repoOwner: string;
  branch: string; userId: string; orgId?: string;
  localFiles?: { path: string; content: string }[];
  privateMode?: boolean;
  aiProvider?: "gemini" | "ollama" | "lmstudio";
  aiModel?: string;
  aiEndpoint?: string;
}

export const scanQueue = new Bull<ScanJobData>("scan-jobs", config.redis.url, {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    timeout: 10 * 60 * 1000,
  },
});
