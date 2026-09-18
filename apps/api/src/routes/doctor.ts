/**
 * GET /api/v1/doctor
 *
 * Reports which measured-audit tools are actually installed and their versions.
 * This is the honesty endpoint: a missing tool is reported as missing, never
 * silently skipped. `degraded: true` means the audit will exclude tools.
 */
import { Router } from "express";
import { DEFAULT_ADAPTERS, resolveTool, toolVersion } from "@overlay365/audit-core";
import { asyncHandler } from "../middleware/asyncHandler";

const router: Router = Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const adapters = await Promise.all(
      DEFAULT_ADAPTERS.map(async (a) => {
        const cmd = await resolveTool(a.tool);
        return {
          id: a.id,
          tool: a.tool,
          category: a.category,
          present: Boolean(cmd),
          version: cmd ? await toolVersion(cmd) : null,
          path: cmd,
        };
      }),
    );
    const present = adapters.filter((a) => a.present).length;
    res.json({
      data: {
        adapters,
        present,
        total: adapters.length,
        degraded: present < adapters.length,
      },
    });
  }),
);

export default router;
