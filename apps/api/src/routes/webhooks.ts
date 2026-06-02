import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import { z } from "zod";
import { logger } from "../logger";
import { handlePushEvent, handlePullRequestEvent, verifyGitHubSignature } from "../services/githubWebhook";
import { AppError } from "../middleware/errorHandler";

const router: ExpressRouter = Router();

// POST /webhooks/github — GitHub webhook receiver
router.post("/github", async (req: any, res: Response) => {
  const signature = req.headers["x-hub-signature-256"] as string;
  const event = req.headers["x-github-event"] as string;
  const deliveryId = req.headers["x-github-delivery"] as string;

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn("GitHub webhook secret not configured");
    return res.status(501).json({ error: "Webhook not configured" });
  }

  if (!signature || !event) {
    logger.warn({ signature: !!signature, event }, "Missing GitHub webhook headers");
    return res.status(400).json({ error: "Missing webhook headers" });
  }

  // Verify signature
  const payload = req.rawBody || Buffer.from(JSON.stringify(req.body));
  if (!verifyGitHubSignature(payload, signature, webhookSecret)) {
    logger.warn({ deliveryId }, "Invalid GitHub webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  logger.info({ event, deliveryId }, "Received GitHub webhook");

  try {
    // Handle events
    if (event === "push") {
      const result = await handlePushEvent(req.body);
      if (result) {
        return res.status(202).json({ received: true, jobId: result.jobId });
      }
    } else if (event === "pull_request") {
      const result = await handlePullRequestEvent(req.body);
      if (result) {
        return res.status(202).json({ received: true, commented: result.commented });
      }
    } else {
      logger.debug({ event, deliveryId }, "Ignoring GitHub event");
    }

    res.json({ received: true, event });
  } catch (err: any) {
    logger.error({ error: err.message, event, deliveryId }, "Error processing webhook");
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

export default router;
