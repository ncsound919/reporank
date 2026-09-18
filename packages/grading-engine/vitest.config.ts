import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Never run compiled copies under dist/ — they double-count results and
    // drift from source. Only run the TypeScript sources.
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
