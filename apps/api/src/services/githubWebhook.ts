import crypto from "node:crypto";
import { logger } from "../logger";

export function verifyGitHubSignature(
  payload: Buffer | string,
  signature: string,
  secret: string,
): boolean {
  const sig = typeof payload === "string" ? Buffer.from(payload) : payload;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(sig);
  const expected = `sha256=${hmac.digest("hex")}`;

  try {
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (receivedBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

interface PushPayload {
  ref?: string;
  repository?: { full_name?: string; clone_url?: string };
  commits?: Array<{ id?: string; message?: string }>;
  head_commit?: { id?: string; message?: string };
  sender?: { login?: string };
}

interface PullRequestPayload {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    html_url?: string;
    head?: { ref?: string; repo?: { full_name?: string } };
    base?: { ref?: string };
    user?: { login?: string };
  };
  repository?: { full_name?: string };
  sender?: { login?: string };
}

export async function handlePushEvent(
  payload: PushPayload,
): Promise<{ jobId: string } | null> {
  logger.info(
    { repo: payload.repository?.full_name, ref: payload.ref },
    "Processing push event",
  );
  return { jobId: crypto.randomUUID() };
}

export async function handlePullRequestEvent(
  payload: PullRequestPayload,
): Promise<{ commented: boolean } | null> {
  logger.info(
    {
      repo: payload.repository?.full_name,
      action: payload.action,
      pr: payload.pull_request?.number,
    },
    "Processing pull request event",
  );
  return { commented: false };
}
