import { Router } from "express";
import Stripe from "stripe";
import { config } from "../config";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

const router = Router() as Router;

function getStripe(): Stripe {
  if (!config.stripe.secretKey) throw new AppError(503, "Stripe not configured", "STRIPE_NOT_CONFIGURED");
  return new Stripe(config.stripe.secretKey);
}

router.post("/checkout", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const stripe = getStripe();
    const { plan, orgId } = req.body;
    if (!["pro", "enterprise"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });

    const org = orgId
      ? await prisma.org.findUnique({ where: { id: orgId } })
      : await prisma.org.create({
          data: { name: `${req.userId}'s Org`, slug: `org-${req.userId!.slice(0, 8)}` },
        });

    if (!org) return res.status(404).json({ error: "Organization not found" });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan === "pro" ? "price_pro_monthly" : "price_enterprise_monthly", quantity: 1 }],
      success_url: `${config.appUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appUrl}/pricing`,
      metadata: { orgId: org.id, userId: req.userId! },
    });

    res.json({ data: { url: session.url } });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(502).json({ error: "Payment service unavailable" });
  }
});

router.post("/webhook", async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch {
    return res.status(400).json({ error: "Invalid signature" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.orgId;
    if (orgId) {
      await prisma.org.update({
        where: { id: orgId },
        data: { plan: "pro", scansThisPeriod: 0, periodStart: new Date() },
      });
      await prisma.subscription.create({
        data: {
          orgId,
          stripeSubscriptionId: session.subscription as string,
          plan: "pro",
          status: "active",
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
            status: "active",
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
    console.warn("Invoice payment failed:", invoice.id, invoice.subscription);
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
        data: { status: "canceled" },
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
    console.error("Stripe error:", err);
    res.status(502).json({ error: "Payment service unavailable" });
  }
});

export default router;
