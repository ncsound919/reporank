import { Router } from "express";
import Stripe from "stripe";
import { config } from "../config";
import { prisma } from "../db/client";
import { logger } from "../logger";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError, ErrorCodes } from "../middleware/errorHandler";
import { SubscriptionStatus } from "../constants";

const router = Router() as Router;

// In-memory dedup of processed Stripe event IDs (prevents duplicate webhook processing)
const processedEvents = new Set<string>();
const EVENT_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function hasProcessedEvent(eventId: string): boolean {
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  // Auto-evict after TTL to prevent memory leak
  setTimeout(() => processedEvents.delete(eventId), EVENT_DEDUP_TTL_MS);
  return false;
}

function getStripe(): Stripe {
  if (!config.stripe.secretKey) throw new AppError(503, "Stripe not configured", ErrorCodes.STRIPE_NOT_CONFIGURED);
  return new Stripe(config.stripe.secretKey);
}

function getWebhookSecret(): string {
  if (!config.stripe.webhookSecret) throw new AppError(503, "Stripe webhook secret not configured", ErrorCodes.STRIPE_WEBHOOK_NOT_CONFIGURED);
  return config.stripe.webhookSecret;
}

router.post("/checkout", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const stripe = getStripe();
    const { plan, orgId } = req.body;
    if (!["pro", "enterprise"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
    if (!orgId) throw new AppError(400, "Organization ID is required", ErrorCodes.ORG_REQUIRED);

    const org = await prisma.org.findUnique({ where: { id: orgId } });
    if (!org) throw new AppError(404, "Organization not found", ErrorCodes.NOT_FOUND);

    // Verify user is member of this org
    const membership = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: req.userId! } },
    });
    if (!membership) throw new AppError(403, "Not a member of this organization", ErrorCodes.FORBIDDEN);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan === "pro" ? config.stripe.priceIdPro : config.stripe.priceIdEnterprise, quantity: 1 }],
      success_url: `${config.appUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appUrl}/pricing`,
      metadata: { orgId: org.id, userId: req.userId! },
    });

    res.json({ data: { url: session.url } });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ error: errorMessage }, "Stripe error in checkout");
    res.status(502).json({ error: "Payment service unavailable" });
  }
});

router.post("/webhook", async (req, res) => {
  const stripe = getStripe();
  const webhookSecret = getWebhookSecret();
  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch {
    return res.status(400).json({ error: "Invalid signature" });
  }

  // Idempotency: skip already-processed events (Stripe may retry on network issues)
  if (hasProcessedEvent(event.id)) {
    logger.info({ eventId: event.id }, "Skipping duplicate Stripe webhook event");
    return res.json({ received: true, deduplicated: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.orgId;
    if (orgId) {
      await prisma.org.update({
        where: { id: orgId },
        data: { plan: "pro", scansThisPeriod: 0, periodStart: new Date() },
      });
      // Use upsert to prevent duplicate subscription records on retry
      await prisma.subscription.upsert({
        where: { stripeSubscriptionId: session.subscription as string },
        update: { status: SubscriptionStatus.ACTIVE, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        create: {
          orgId,
          stripeSubscriptionId: session.subscription as string,
          plan: "pro",
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }

  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = invoice.subscription as string;
    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const orgId = sub.metadata?.orgId;
      if (orgId) {
        await prisma.subscription.update({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
          },
        });
        await prisma.org.update({
          where: { id: orgId },
          data: {
            plan: sub.items.data[0]?.price?.nickname?.toLowerCase() ?? "pro",
            periodStart: new Date(sub.current_period_start * 1000),
            periodEnd: new Date(sub.current_period_end * 1000),
          },
        });
      }
    }
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    logger.warn({ invoiceId: invoice.id, subscriptionId: invoice.subscription }, "Invoice payment failed");
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    const orgId = subscription.metadata?.orgId;
    if (orgId) {
      await prisma.subscription.update({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        },
      });
      await prisma.org.update({
        where: { id: orgId },
        data: {
          plan: subscription.items.data[0]?.price?.nickname?.toLowerCase() ?? "pro",
          periodStart: new Date(subscription.current_period_start * 1000),
          periodEnd: new Date(subscription.current_period_end * 1000),
        },
      });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const orgId = subscription.metadata?.orgId;
    if (orgId) {
      await prisma.subscription.update({
        where: { stripeSubscriptionId: subscription.id },
        data: { status: SubscriptionStatus.CANCELED },
      });
      await prisma.org.update({
        where: { id: orgId },
        data: { plan: "free" },
      });
    }
  }

  res.json({ received: true });
});

router.post("/portal", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const stripe = getStripe();
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user?.stripeCustomerId) return res.status(400).json({ error: "No active subscription" });

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${config.appUrl}/settings`,
    });
    res.json({ data: { url: session.url } });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ error: errorMessage }, "Stripe error in portal");
    res.status(502).json({ error: "Payment service unavailable" });
  }
});

export default router;
