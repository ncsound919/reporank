export interface AdapterResult {
  tool: string;
  success: boolean;
  output: string;
  errors?: string[];
}

export interface ToolAdapter {
  run(cwd: string): Promise<AdapterResult>;
}

export * from './adapters/eslint.js';
export * from './adapters/vitest.js';
export * from './adapters/pytest.js';
