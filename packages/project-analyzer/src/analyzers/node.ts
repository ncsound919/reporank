import fs from 'node:fs/promises';
import path from 'node:path';

export async function analyzeNode(dir: string) {
  try {
    const pkgJsonPath = path.join(dir, 'package.json');
    const content = await fs.readFile(pkgJsonPath, 'utf8');
    const pkg = JSON.parse(content);
    
    return {
      found: true,
      hasEslint: !!(pkg.devDependencies?.eslint || pkg.dependencies?.eslint),
      hasVitest: !!(pkg.devDependencies?.vitest || pkg.dependencies?.vitest),
      hasJest: !!(pkg.devDependencies?.jest || pkg.dependencies?.jest),
      hasTypeScript: !!(pkg.devDependencies?.typescript || pkg.dependencies?.typescript),
      scripts: pkg.scripts || {}
    };
  } catch (err) {
    return { found: false };
  }
}
