export interface RepoData {
  metadata: { owner: string; repo: string; language: string; stars: number; forks: number; openIssues: number; pushedAt: string };
  readme: string; packageJson: string; fileTree: string[];
  sourceFiles: { path: string; content: string }[];
}

/**
 * Stratified file sampler — ensures representation across directories.
 * Picks up to `maxTotal` files, taking at most `maxPerDir` from each top-level
 * directory so large monorepos are not scored on a single corner of the tree.
 */
function stratifiedSample(
  paths: string[],
  maxTotal: number = 50,
  maxPerDir: number = 5,
): string[] {
  const byDir = new Map<string, string[]>();
  for (const p of paths) {
    const topDir = p.includes("/") ? p.split("/")[0] : "__root__";
    if (!byDir.has(topDir)) byDir.set(topDir, []);
    byDir.get(topDir)!.push(p);
  }
  const selected: string[] = [];
  // Round-robin across directories until we hit the cap
  const dirs = [...byDir.values()].map(files => files.slice(0, maxPerDir));
  let added = true;
  while (selected.length < maxTotal && added) {
    added = false;
    for (const dirFiles of dirs) {
      if (selected.length >= maxTotal) break;
      const next = dirFiles.shift();
      if (next !== undefined) { selected.push(next); added = true; }
    }
  }
  return selected;
}

export async function fetchRepoData(owner: string, repo: string, token?: string): Promise<RepoData> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const gh = async <T>(path: string): Promise<T> => { const r = await fetch(`https://api.github.com${path}`, { headers }); if (!r.ok) throw new Error(`GitHub API ${r.status}`); return r.json() as Promise<T>; };

  const repoData = await gh<any>(`/repos/${owner}/${repo}`);
  let readme = "";
  try { const rd = await gh<any>(`/repos/${owner}/${repo}/readme`); readme = Buffer.from(rd.content, "base64").toString("utf-8"); } catch (e) { console.warn(`No README for ${owner}/${repo}:`, e instanceof Error ? e.message : "unknown"); }
  const tree = await gh<any>(`/repos/${owner}/${repo}/git/trees/${repoData.default_branch}?recursive=1`);
  const fileTree = (tree.tree || []).map((i: any) => i.path);

  let packageJson = "";
  try { const pkg = await gh<any>(`/repos/${owner}/${repo}/contents/package.json`); packageJson = Buffer.from(pkg.content, "base64").toString("utf-8"); } catch (e) { console.warn(`No package.json for ${owner}/${repo}:`, e instanceof Error ? e.message : "unknown"); }

  const sourceFiles: { path: string; content: string }[] = [];
  const exts = new Set([".ts",".tsx",".js",".jsx",".py",".go",".rs",".java",".rb",".php"]);
  const candidates = fileTree.filter((f: string) => exts.has(f.slice(f.lastIndexOf("."))));
  const sampled = stratifiedSample(candidates, 50, 5);

  const fetchPromises = sampled.map(async (fp: string) => {
      try {
        const f = await gh<any>(`/repos/${owner}/${repo}/contents/${fp}`);
        return { path: fp, content: Buffer.from(f.content, "base64").toString("utf-8").slice(0, 10000) };
      } catch { return null; }
    });

  const results = await Promise.allSettled(fetchPromises);
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      sourceFiles.push(result.value);
    }
  }

  return { metadata: { owner, repo, language: repoData.language || "Unknown", stars: repoData.stargazers_count || 0, forks: repoData.forks_count || 0, openIssues: repoData.open_issues_count || 0, pushedAt: repoData.pushed_at || "" }, readme, packageJson, fileTree, sourceFiles };
}


export function repoDataToGradeInput(data: RepoData) {
  return { repoUrl: `https://github.com/${data.metadata.owner}/${data.metadata.repo}`, repoName: data.metadata.repo, repoOwner: data.metadata.owner, mainLanguage: data.metadata.language, starsCount: data.metadata.stars, forksCount: data.metadata.forks, openIssuesCount: data.metadata.openIssues, lastPushedAt: data.metadata.pushedAt, readmeContent: data.readme, packageJson: data.packageJson, fileTree: data.fileTree, sourceFiles: data.sourceFiles };
}
