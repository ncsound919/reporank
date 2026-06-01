export type PlanTier = "free" | "pro" | "enterprise";

export interface PlanLimits {
  scansPerMonth: number; teamMembers: number; clawModules: number;
  apiRateLimit: number; hasFixPacks: boolean; hasCompliance: boolean;
  hasSso: boolean; hasSelfHosted: boolean; hasWebhooks: boolean;
  supportLevel: "community" | "email" | "slack";
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { scansPerMonth: 3, teamMembers: 1, clawModules: 2, apiRateLimit: 1,
    hasFixPacks: false, hasCompliance: false, hasSso: false, hasSelfHosted: false, hasWebhooks: false, supportLevel: "community" },
  pro: { scansPerMonth: 150, teamMembers: 5, clawModules: 13, apiRateLimit: 5,
    hasFixPacks: true, hasCompliance: true, hasSso: false, hasSelfHosted: false, hasWebhooks: true, supportLevel: "email" },
  enterprise: { scansPerMonth: -1, teamMembers: -1, clawModules: 23, apiRateLimit: 50,
    hasFixPacks: true, hasCompliance: true, hasSso: true, hasSelfHosted: true, hasWebhooks: true, supportLevel: "slack" },
};
