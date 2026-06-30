import { execa } from 'execa';
import type { ToolAdapter, AdapterResult } from '../index.js';

export const eslintAdapter: ToolAdapter = {
  async run(cwd: string): Promise<AdapterResult> {
    try {
      const { stdout } = await execa('npx', ['eslint', '.', '--format', 'json'], { cwd });
      return { tool: 'eslint', success: true, output: stdout };
    } catch (err: any) {
      return { 
        tool: 'eslint', 
        success: false, 
        output: err.stdout || '', 
        errors: [err.stderr || err.message] 
      };
    }
  }
};
