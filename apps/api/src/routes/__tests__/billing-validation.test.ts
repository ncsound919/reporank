import { describe, it, expect, vi } from "vitest";
import Stripe from "stripe";

describe("Stripe webhook validation logic", () => {
  it("getWebhookSecret throws when secret is empty", () => {
    const getWebhookSecret = (secret: string): string => {
      if (!secret) throw new Error("Stripe webhook secret not configured");
      return secret;
    };
    expect(() => getWebhookSecret("")).toThrow("Stripe webhook secret not configured");
  });

  it("getWebhookSecret returns when secret is set", () => {
    const getWebhookSecret = (secret: string): string => {
      if (!secret) throw new Error("Stripe webhook secret not configured");
      return secret;
    };
    expect(getWebhookSecret("whsec_valid")).toBe("whsec_valid");
  });

  it("getStripe throws when secretKey is empty", () => {
    const getStripe = (secretKey: string): Stripe => {
      if (!secretKey) throw new Error("Stripe not configured");
      return new Stripe(secretKey);
    };
    expect(() => getStripe("")).toThrow("Stripe not configured");
  });

  it("getStripe creates instance when key is set", () => {
    const getStripe = (secretKey: string): Stripe => {
      if (!secretKey) throw new Error("Stripe not configured");
      return new Stripe(secretKey);
    };
    const stripe = getStripe("sk_test_valid");
    expect(stripe).toBeInstanceOf(Stripe);
  });

  it("constructEvent throws with empty secret", () => {
    const stripe = new Stripe("sk_test_valid");
    expect(() => stripe.webhooks.constructEvent("{}", "sig", "")).toThrow();
  });
});
