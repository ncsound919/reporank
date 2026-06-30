import { simpleGit } from 'simple-git';

export async function analyzeFitness(dir: string, depth: number = 10) {
  const git = simpleGit(dir);
  const log = await git.log({ maxCount: depth });
  
  const history = [];
  
  for (const commit of log.all) {
    let score = 50; // Base score
    const message = commit.message.toLowerCase();
    
    if (message.includes('fix') || message.includes('bug')) score += 20;
    if (message.includes('test')) score += 15;
    if (message.includes('refactor')) score += 15;
    if (message.includes('wip') || message.includes('hack')) score -= 20;
    
    // Normalize to 0-100
    score = Math.max(0, Math.min(100, score));
    
    history.push({
      hash: commit.hash,
      date: commit.date,
      score
    });
  }
  
  return history.reverse(); // oldest to newest
}
