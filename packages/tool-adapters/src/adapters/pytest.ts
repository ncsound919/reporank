import { execa } from 'execa';
import type { ToolAdapter, AdapterResult } from '../index.js';

export const pytestAdapter: ToolAdapter = {
  async run(cwd: string): Promise<AdapterResult> {
    try {
      const { stdout } = await execa('pytest', [], { cwd });
      return { tool: 'pytest', success: true, output: stdout };
    } catch (err: any) {
      return { 
        tool: 'pytest', 
        success: false, 
        output: err.stdout || '', 
        errors: [err.stderr || err.message] 
      };
    }
  }
};
