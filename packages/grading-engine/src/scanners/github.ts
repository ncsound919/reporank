export interface RepoData {
  metadata: { owner: string; repo: string; language: string; stars: number; forks: number; openIssues: number; pushedAt: string };
  readme: string; packageJson: string; fileTree: string[];
  sourceFiles: { path: string; content: string }[];
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
  const fetchPromises = fileTree
    .filter((f: string) => exts.has(f.slice(f.lastIndexOf("."))))
    .slice(0, 8)
    .map(async (fp: string) => {
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
