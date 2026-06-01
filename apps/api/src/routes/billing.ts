import { Router, raw } from "express";
import Stripe from "stripe";
import { config } from "../config";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/auth";

const router = Router() as Router;
const stripe = new Stripe(config.stripe.secretKey);

router.post("/checkout", authMiddleware, async (req: AuthRequest, res) => {
  try {
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

router.post("/webhook", raw({ type: "application/json" }), async (req, res) => {
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

  res.json({ received: true });
});

router.post("/portal", authMiddleware, async (req: AuthRequest, res) => {
  try {
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
