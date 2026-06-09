import { Router } from "express";
import { prisma } from "../db/client";
import rateLimit from "express-rate-limit";
import { ScanStatus } from "../constants";

const router: Router = Router();

const badgeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/:owner/:repo", badgeRateLimit, async (req, res) => {
  const scan = await prisma.scan.findFirst({
    where: { repoOwner: req.params.owner, repoName: req.params.repo, status: ScanStatus.COMPLETE, repoUrl: { not: "local" } },
    orderBy: { createdAt: "desc" },
  });

  const score = scan?.overallScore ?? 0;
  const color = score >= 80 ? "brightgreen" : score >= 60 ? "yellow" : score >= 40 ? "orange" : "red";
  const label = "RepoRank";
  const message = score.toString();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="20">
    <linearGradient id="b" x2="0" y2="100%">
      <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
      <stop offset="1" stop-opacity=".1"/>
    </linearGradient>
    <rect rx="3" width="110" height="20" fill="#555"/>
    <rect rx="3" x="55" width="55" height="20" fill="${color === "brightgreen" ? "#4c1" : color}"/>
    <g fill="#fff" font-family="DejaVu Sans, Verdana, sans-serif" font-size="11">
      <text x="27.5" y="14" text-anchor="middle">${label}</text>
      <text x="82.5" y="14" text-anchor="middle">${message}</text>
    </g>
  </svg>`;

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "max-age=3600");
  res.send(svg);
});

export default router;
