import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "*.apiKey", "*.api_key", "*.API_KEY",
      "*.secret", "*.secretKey", "*.secret_key",
      "*.token", "*.accessToken", "*.authToken",
      "*.password", "*.GEMINI_API_KEY", "*.OPENAI_API_KEY",
      "*.STRIPE_SECRET_KEY", "*.JWT_SECRET",
      "*.stripe.secretKey", "*.stripe.webhookSecret",
    ],
    censor: "***REDACTED***",
  },
});