import { execa } from "execa";

export async function runTrufflehog(repoPath: string) {
  try {
    const { stdout } = await execa(
      "trufflehog",
      ["filesystem", "--json", "--no-update", repoPath],
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 120000 }
    );
    return stdout.trim().split("\n").filter(Boolean).map(l => {
      try {
        const p = JSON.parse(l);
        return { detector: p.DetectorName || "unknown", verified: p.Verified || false, raw: (p.Raw || "").slice(0, 20) };
      } catch { return null; }
    }).filter(Boolean);
  } catch (e: any) {
    if (e.stderr?.includes("not found") || e.message?.includes("not found")) return [];
    console.warn("TruffleHog:", e.message);
    return [];
  }
}

