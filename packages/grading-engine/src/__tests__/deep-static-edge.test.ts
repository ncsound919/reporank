import { describe, it, expect } from "vitest";
import { analyzeDeep } from "../analyzers/deep-static";

describe("analyzeDeep - edge cases", () => {
  it("profiles language by extension", () => {
    const files = [
      { path: "main.ts", content: "const x = 1;" },
      { path: "style.css", content: ".cls { color: red; }" },
      { path: "index.html", content: "<html></html>" },
    ];
    const result = analyzeDeep(files, ["main.ts", "style.css", "index.html"]);
    expect(result.languageBreakdown.length).toBeGreaterThanOrEqual(3);
  });
});
