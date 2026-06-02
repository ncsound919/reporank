import { describe, it, expect } from "vitest";
import { analyzeSession, type SessionInput, type ChatTurn } from "../analyzers/education";

function makeTurn(role: "user" | "assistant", content: string, opts: Partial<ChatTurn> = {}): ChatTurn {
  return { role, content, ...opts };
}

const engagedSession: SessionInput = {
  studentId: "s1",
  assignmentId: "a1",
  turns: [
    makeTurn("user", "I need to write a function that calculates factorial. Can you explain the recursive approach first?"),
    makeTurn("assistant", "Sure! A recursive function calls itself with a smaller input...", { producedCode: false }),
    makeTurn("user", "Why do we need a base case? What happens if n is 0?"),
    makeTurn("assistant", "Without a base case, the function would call itself forever...", { producedCode: false }),
    makeTurn("user", "OK now write the implementation. I want it to handle n=0 specifically."),
    makeTurn("assistant", "Here's the implementation...", { producedCode: true }),
    makeTurn("user", "I prefer the comment style to use // not /* */. Also can you extract the multiplication step into a helper?"),
    makeTurn("assistant", "Updated...", { producedCode: true }),
    makeTurn("user", "Why does it return 1 for n=0? Why not 0? Explain the math."),
    makeTurn("assistant", "0! is defined as 1 by convention, similar to how an empty product equals 1...", { producedCode: false }),
  ],
  finalSubmission: [
    {
      path: "src/solution.ts",
      content: `// Calculate factorial recursively
// The base case returns 1 for n=0 or n=1
// 0! is defined as 1 mathematically
function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
`,
    },
  ],
};

const vibeSession: SessionInput = {
  studentId: "s2",
  assignmentId: "a1",
  turns: [
    makeTurn("user", "Make a factorial function"),
    makeTurn("assistant", "...", { producedCode: true }),
    makeTurn("user", "Make it work for big numbers"),
    makeTurn("assistant", "...", { producedCode: true }),
    makeTurn("user", "Create tests for it"),
    makeTurn("assistant", "...", { producedCode: true }),
    makeTurn("user", "Write a README"),
    makeTurn("assistant", "...", { producedCode: true }),
    makeTurn("user", "Do the next assignment"),
    makeTurn("assistant", "...", { producedCode: true }),
  ],
  finalSubmission: [
    { path: "src/x.ts", content: "function factorial(n){return n<=1?1:n*factorial(n-1);}" },
  ],
};

const emptySession: SessionInput = {
  studentId: "s3", assignmentId: "a1", turns: [], finalSubmission: [],
};

describe("analyzeSession", () => {
  it("flags empty session with low understanding", () => {
    const result = analyzeSession(emptySession);
    expect(result.understandingScore).toBe(0);
    expect(result.redFlags).toContain("No chat session recorded.");
  });

  it("rewards engaged student with high scores", () => {
    const result = analyzeSession(engagedSession);
    expect(result.understandingScore).toBeGreaterThan(60);
    expect(result.autonomyScore).toBeGreaterThan(60);
    expect(result.learningEfficiency).toBeGreaterThan(50);
    expect(result.redFlags.length).toBeLessThan(2);
    expect(result.positiveIndicators.length).toBeGreaterThanOrEqual(2);
  });

  it("flags vibe-coder with multiple red flags", () => {
    const result = analyzeSession(vibeSession);
    expect(result.redFlags.length).toBeGreaterThan(1);
    expect(result.understandingScore).toBeLessThan(50);
  });

  it("generates healthy summary for engaged student", () => {
    const result = analyzeSession(engagedSession);
    expect(result.summary).toMatch(/healthy|engaged|active/i);
  });

  it("generates red-flag summary for vibe session", () => {
    const result = analyzeSession(vibeSession);
    expect(result.summary).toMatch(/vibe|outsourced|red flag|incomplete|mixed|engaged partially/i);
  });

  it("scores autonomy higher for specific instructions", () => {
    const result = analyzeSession(engagedSession);
    expect(result.autonomyScore).toBeGreaterThan(60);
  });

  it("detects lack of follow-up questions", () => {
    const flat: SessionInput = {
      ...vibeSession,
      turns: [
        makeTurn("user", "do it"),
        makeTurn("assistant", "ok", { producedCode: true }),
        makeTurn("user", "next thing"),
        makeTurn("assistant", "ok", { producedCode: true }),
        makeTurn("user", "more"),
        makeTurn("assistant", "ok", { producedCode: true }),
      ],
    };
    const result = analyzeSession(flat);
    expect(result.redFlags.some(f => f.toLowerCase().includes("follow-up"))).toBe(true);
  });

  it("returns scores in 0-100 range", () => {
    const result = analyzeSession(engagedSession);
    expect(result.understandingScore).toBeGreaterThanOrEqual(0);
    expect(result.understandingScore).toBeLessThanOrEqual(100);
    expect(result.autonomyScore).toBeGreaterThanOrEqual(0);
    expect(result.autonomyScore).toBeLessThanOrEqual(100);
    expect(result.learningEfficiency).toBeGreaterThanOrEqual(0);
    expect(result.learningEfficiency).toBeLessThanOrEqual(100);
  });

  it("rewards conceptual questions in learning efficiency", () => {
    const conceptual: SessionInput = {
      ...vibeSession,
      turns: [
        makeTurn("user", "What is the best practice for handling edge cases in recursion?"),
        makeTurn("assistant", "Use a base case...", { producedCode: false }),
        makeTurn("user", "Why is the base case n=0 and not n=1?"),
        makeTurn("assistant", "...", { producedCode: false }),
        makeTurn("user", "How does the call stack work for recursion?"),
        makeTurn("assistant", "...", { producedCode: false }),
      ],
    };
    const result = analyzeSession(conceptual);
    expect(result.learningEfficiency).toBeGreaterThan(40);
  });
});
