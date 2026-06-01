import "dotenv/config";
export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  appUrl: process.env.APP_URL || "http://localhost:5173",
  nodeEnv: process.env.NODE_ENV || "development",
  jwt: { secret: process.env.JWT_SECRET || "dev-secret-change-in-production", expiresIn: "7d" },
  github: { clientId: process.env.GITHUB_CLIENT_ID || "", clientSecret: process.env.GITHUB_CLIENT_SECRET || "" },
  gemini: { apiKey: process.env.GEMINI_API_KEY || "", model: process.env.GEMINI_MODEL || "gemini-2.5-flash" },
  stripe: { secretKey: process.env.STRIPE_SECRET_KEY || "", webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "" },
  redis: { url: process.env.REDIS_URL || "redis://localhost:6379" },
};
