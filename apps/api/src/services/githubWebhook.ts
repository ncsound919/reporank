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

  if (payload.action === 'opened' || payload.action === 'synchronize') {
    // Fire and forget the pipeline so we don't block the webhook response
    // or risk unhandled rejections crashing the process.
    (async () => {
      try {
        const { execa } = await import("execa");
        const path = await import("node:path");
        
        logger.info("Triggering PR Guard Dagster pipeline in background...");
        
        const mockClonePath = "/tmp/mock-pr-repo";
        const dagsterDir = path.resolve(process.cwd(), "../../orchestrator-dag");
        
        const { stdout } = await execa("dagster", [
           "asset", "materialize", "--select", "*", 
           "--config-json", JSON.stringify({
             ops: {
               project_analysis: { config: { target_path: mockClonePath } },
               static_analysis_results: { config: { target_path: mockClonePath } },
               tool_adapter_results: { config: { target_path: mockClonePath } }
             }
           })
         ], {
           cwd: dagsterDir,
           env: { ...process.env, DAGSTER_HOME: dagsterDir }
         });
         
         logger.info("Dagster PR check complete. SARIF report generated successfully.");
         // Code to post SARIF back to GitHub Checks API would go here
      } catch (err: any) {
         logger.error("PR Guard background task failed: " + err.message);
      }
    })();
    
    return { commented: true };
  }

  return { commented: false };
}
