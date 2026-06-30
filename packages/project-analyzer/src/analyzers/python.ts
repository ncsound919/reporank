import fs from 'node:fs/promises';
import path from 'node:path';

export async function analyzePython(dir: string) {
  try {
    const pyprojectPath = path.join(dir, 'pyproject.toml');
    const content = await fs.readFile(pyprojectPath, 'utf8');
    
    return {
      found: true,
      hasPytest: content.includes('pytest'),
      hasRuff: content.includes('ruff'),
      hasFlake8: content.includes('flake8'),
    };
  } catch (err) {
    try {
      const reqPath = path.join(dir, 'requirements.txt');
      const content = await fs.readFile(reqPath, 'utf8');
      return {
        found: true,
        hasPytest: content.includes('pytest'),
        hasRuff: content.includes('ruff'),
        hasFlake8: content.includes('flake8'),
      };
    } catch (e) {
      return { found: false };
    }
  }
}
