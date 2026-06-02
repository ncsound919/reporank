/**
 * AI-Generated README.md generator — produces a complete README from the analysis.
 * Includes architecture diagram, badges, setup instructions, and contribution guide.
 */
export interface GeneratedReadme {
  markdown: string;
  sections: string[];
  summary: string;
}

export function generateReadme(
  repoName: string,
  repoOwner: string,
  description: string,
  score: number,
  grade: string,
  language: string,
  fileCount: number,
  mainLang: string,
  archDiagramMermaid: string,
  quickWins: { title: string; severity: string }[],
  recommendations: string[],
): GeneratedReadme {
  const sections: string[] = [];
  const badgeColor = score >= 80 ? "brightgreen" : score >= 60 ? "yellow" : score >= 40 ? "orange" : "red";

  let md = "";

  // Title + badges
  md += `# ${repoName}\n\n`;
  md += `![RepoRank](https://img.shields.io/badge/RepoRank-${score}-${badgeColor})\n`;
  md += `![Language](https://img.shields.io/badge/language-${encodeURIComponent(mainLang || "Unknown")}-blue)\n`;
  md += `![Files](https://img.shields.io/badge/files-${fileCount}-informational)\n`;
  md += `![Grade](https://img.shields.io/badge/grade-${grade}-${badgeColor})\n\n`;
  sections.push("badges");

  // Description
  md += `## Overview\n\n${description || `A ${language || "codebase"} with ${fileCount} files, scoring ${score}/100 on the RepoRank scale.`}\n\n`;
  sections.push("overview");

  // Quick stats
  md += `## Quick Stats\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| RepoRank Score | ${score}/100 (${grade}) |\n`;
  md += `| Primary Language | ${mainLang || "Mixed"} |\n`;
  md += `| Total Files | ${fileCount} |\n`;
  md += `| RepoRank Grade | ${grade} |\n\n`;
  sections.push("stats");

  // Quick wins
  if (quickWins.length > 0) {
    md += `## Quick Wins\n\n`;
    md += `Prioritized improvements identified by [RepoRank](https://reporank.dev):\n\n`;
    for (const w of quickWins.slice(0, 5)) {
      md += `- **${w.title}** (${w.severity})\n`;
    }
    md += `\nRun \`npx @reporank/cli scan ${repoOwner}/${repoName}\` for the full report.\n\n`;
    sections.push("quick-wins");
  }

  // Architecture diagram
  if (archDiagramMermaid) {
    md += `## Architecture\n\n`;
    md += "```mermaid\n";
    md += archDiagramMermaid;
    md += "```\n\n";
    sections.push("architecture");
  }

  // Recommendations
  if (recommendations.length > 0) {
    md += `## Recommendations\n\n`;
    for (const r of recommendations) {
      md += `- ${r}\n`;
    }
    md += "\n";
    sections.push("recommendations");
  }

  // Setup
  md += `## Getting Started\n\n`;
  md += `\`\`\`bash\n# Clone the repository\ngit clone https://github.com/${repoOwner}/${repoName}.git\ncd ${repoName}\n\n# Install dependencies\n`;
  md += `npm install\n# or: pnpm install\n# or: yarn\n\n`;
  md += `# Run development server\nnpm run dev\n\`\`\`\n\n`;
  sections.push("setup");

  // Contributing
  md += `## Contributing\n\n`;
  md += `1. Fork the repository\n`;
  md += `2. Create your feature branch (\`git checkout -b feature/amazing-feature\`)\n`;
  md += `3. Commit your changes (\`git commit -m 'feat: add amazing feature'\`)\n`;
  md += `4. Push to the branch (\`git push origin feature/amazing-feature\`)\n`;
  md += `5. Open a Pull Request\n\n`;
  sections.push("contributing");

  // Badge
  md += `---\n\n`;
  md += `<sub>Analyzed by [RepoRank](https://reporank.dev) — Codebase grading for modern developers.</sub>\n`;

  return {
    markdown: md,
    sections,
    summary: `Generated README.md with ${sections.length} sections: ${sections.join(", ")}.`,
  };
}
