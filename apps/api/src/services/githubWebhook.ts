import crypto from "node:crypto";
import { prisma } from "../db/client";
import { logger } from "../logger";

interface GitHubEvent {
  action?: string;
  ref?: string;
  before?: string;
  after?: string;
  repository?: {
    id: number;
    name: string;
    full_name: string;
    owner?: { login: string; avatar_url?: string };
    url?: string;
    html_url?: string;
    description?: string;
  };
  pusher?: { name: string; email: string };
  pull_request?: {
    number: number;
    title: string;
    body?: string;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    state: string;
    user?: { login: string; avatar_url?: string };
  };
  sender?: { login: string };
}

/**
 * Verify GitHub webhook signature
 */
export function verifyGitHubSignature(
  payload: Buffer,
  signature: string,
  secret: string
): boolean {
  const hash = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const expectedSignature = `sha256=${hash}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

/**
 * Handle GitHub push event → trigger scan
 */
export async function handlePushEvent(event: GitHubEvent, orgId?: string): Promise<{ jobId: string } | null> {
  const { repository, ref, after } = event;

  if (!repository || !ref || !after) {
    logger.warn({ event }, "Invalid push event payload");
    return null;
  }

  const branch = ref.replace("refs/heads/", "");
  const repoUrl = repository.html_url || `https://github.com/${repository.full_name}`;

  try {
    logger.info({ repo: repository.full_name, branch, commit: after }, "GitHub push detected");

    // Find or create scan job
    // This would integrate with your job queue (Bull)
    // For now, return a job reference
    return { jobId: `github-push-${repository.id}-${Date.now()}` };
  } catch (err: any) {
    logger.error({ error: err.message, repo: repository.full_name }, "Error handling push event");
    return null;
  }
}

/**
 * Handle GitHub pull request event → compute impact, post comment if needed
 */
export async function handlePullRequestEvent(
  event: GitHubEvent,
  orgId?: string
): Promise<{ commented: boolean; scoreBefore?: number; scoreAfter?: number } | null> {
  const { pull_request, repository, action } = event;

  if (!pull_request || !repository || (action !== "opened" && action !== "synchronize")) {
    return null;
  }

  const { number: prNumber, title: prTitle, head, base, user } = pull_request;
  const repoUrl = repository.html_url || `https://github.com/${repository.full_name}`;

  try {
    logger.info({
      repo: repository.full_name,
      pr: prNumber,
      action,
      branch: head.ref,
    }, "GitHub PR detected");

    // Store PR event for tracking
    await prisma.prEvent.create({
      data: {
        configId: "default", // Would be looked up based on repo
        prNumber,
        prTitle,
        headSha: head.sha,
        baseRef: base.ref,
        action: action || "opened",
        status: "pending",
      },
    });

    // Would trigger scan on head commit and compare to base
    // Return mock result for now
    return {
      commented: false,
      scoreBefore: 75,
      scoreAfter: 78,
    };
  } catch (err: any) {
    logger.error({ error: err.message, repo: repository.full_name, pr: prNumber }, "Error handling PR event");
    return null;
  }
}

/**
 * Post GitHub status check (blocks PR if score too low)
 */
export async function postGitHubStatusCheck(
  owner: string,
  repo: string,
  sha: string,
  score: number,
  token: string,
  minScoreThreshold = 60
): Promise<boolean> {
  const state = score >= minScoreThreshold ? "success" : "failure";
  const description = `RepoRank score: ${score}/100`;
  const context = "reporank/health";

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state,
        description,
        context,
        target_url: `https://reporank.dev/scan/${sha}`, // Would link to actual scan
      }),
    });

    if (!response.ok) {
      logger.warn({
        owner,
        repo,
        sha,
        status: response.status,
      }, "Failed to post GitHub status check");
      return false;
    }

    logger.info({ owner, repo, sha, state }, "Posted GitHub status check");
    return true;
  } catch (err: any) {
    logger.error({ error: err.message, owner, repo, sha }, "Error posting GitHub status");
    return false;
  }
}

/**
 * Post lightweight PR comment with score summary
 */
export async function postPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  score: number,
  grade: string,
  token: string,
  scanUrl = "https://reporank.dev"
): Promise<boolean> {
  const comment = `📊 **RepoRank Health Check**\n\n**Score:** ${score}/100 **Grade:** ${grade}\n\n[View Full Report](${scanUrl})`;

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: comment }),
    });

    if (!response.ok) {
      logger.warn({ owner, repo, prNumber, status: response.status }, "Failed to post PR comment");
      return false;
    }

    logger.info({ owner, repo, prNumber }, "Posted PR comment");
    return true;
  } catch (err: any) {
    logger.error({ error: err.message, owner, repo, prNumber }, "Error posting PR comment");
    return false;
  }
}
