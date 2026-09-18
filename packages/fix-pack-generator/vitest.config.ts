import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // setupGitRepo() runs several synchronous git commands; under parallel
    // turbo load the default 10s hook budget is too tight.
    hookTimeout: 30_000,
  },
});
