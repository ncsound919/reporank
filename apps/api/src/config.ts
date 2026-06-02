import "dotenv/config";

const REQUIRED_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "GEMINI_API_KEY",
] as const;

for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    throw new Error(`${v} environment variable is required`);
  }
}

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  appUrl: process.env.APP_URL || "http://localhost:5173",
  nodeEnv: process.env.NODE_ENV || "development",

   jwt: {
     secret: process.env.JWT_SECRET!,
     expiresIn: process.env.JWT_EXPIRES_IN || "7d",
   },

  github: {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    token: process.env.GITHUB_TOKEN || "",
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },

  localAi: {
    provider: (process.env.LOCAL_AI_PROVIDER || "gemini") as "gemini" | "ollama" | "lmstudio",
    model: process.env.LOCAL_AI_MODEL || "",
    endpoint: process.env.LOCAL_AI_ENDPOINT || "http://localhost:11434",
  },

   stripe: {
     secretKey: process.env.STRIPE_SECRET_KEY || "",
     webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
     priceIdPro: process.env.STRIPE_PRICE_PRO || "price_pro_monthly",
     priceIdEnterprise: process.env.STRIPE_PRICE_ENTERPRISE || "price_enterprise_monthly",
   },

  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  deepScan: process.env.DEEP_SCAN === "true",
  logLevel: process.env.LOG_LEVEL || "info",
};
