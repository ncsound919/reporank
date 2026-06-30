import { execa } from 'execa';
import type { ToolAdapter, AdapterResult } from '../index.js';

export const vitestAdapter: ToolAdapter = {
  async run(cwd: string): Promise<AdapterResult> {
    try {
      const { stdout } = await execa('npx', ['vitest', 'run', '--reporter=json'], { cwd });
      return { tool: 'vitest', success: true, output: stdout };
    } catch (err: any) {
      return { 
        tool: 'vitest', 
        success: false, 
        output: err.stdout || '', 
        errors: [err.stderr || err.message] 
      };
    }
  }
};
