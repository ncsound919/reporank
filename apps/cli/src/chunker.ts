// Source file chunker.
//
// Splits a source file into chunks that fit within an LLM's context budget.
// Chunks respect logical boundaries (functions, classes, blank lines) where
// possible so the model sees coherent code rather than mid-function cuts.
//
// Per AGENTS.md: no hardcoded URLs, proper error handling, no eval().

export interface FileChunk {
  index: number;
  /** 1-based starting line of this chunk in the original file */
  startLine: number;
  /** 1-based ending line */
  endLine: number;
  /** The chunk text including a line-number gutter for the model */
  text: string;
}

/** Approximate token count: 1 token ≈ 4 chars for code */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split a source file into chunks under maxTokens each. Returns at minimum
 * one chunk (the whole file if it fits). Chunks are cut on:
 *  1. Blank line followed by a top-level declaration
 *  2. Function/class boundary (heuristic via line indentation)
 *  3. As a last resort, hard cut at the token boundary
 */
export function chunkSourceFile(code: string, language: string, maxTokens: number): FileChunk[] {
  // 1. If the whole file fits, return it as one chunk
  if (estimateTokens(code) <= maxTokens) {
    return [makeChunk(0, code, 1)];
  }

  // 2. Build a list of candidate cut points: every line that could be a
  //    top-level boundary. For TS/JS/Py/Go, this is a line with no leading
  //    whitespace that is not a continuation.
  const lines = code.split("\n");
  const isCutCandidate: boolean[] = lines.map((line, i) => {
    if (i === 0) return false;
    if (line.trim() === "") {
      // Look at the next non-blank line — if it has zero indent, it's a boundary
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === "") continue;
        if (!/^\s/.test(next)) return true;
        break;
      }
      return false;
    }
    return false;
  });

  // 3. Greedy pack: walk through lines, accumulate text; cut when adding the
  //    next candidate would push us over the budget.
  const chunks: FileChunk[] = [];
  let bufStart = 0; // 0-based start line of current buffer
  let bufEnd = 0;
  let chunkIdx = 0;

  for (let i = 1; i <= lines.length; i++) {
    bufEnd = i;
    const bufText = lines.slice(bufStart, i).join("\n");
    const overBudget = estimateTokens(bufText) > maxTokens;

    // Cut if over budget AND we have at least one cut candidate inside [bufStart, i)
    if (overBudget) {
      // Find the most recent cut candidate >= bufStart
      let cutAt = -1;
      for (let k = i - 1; k > bufStart; k--) {
        if (isCutCandidate[k]) { cutAt = k; break; }
      }
      if (cutAt === -1) {
        // No good cut point — hard cut at the previous line
        cutAt = i - 1;
      }
      // Emit chunk [bufStart, cutAt)
      chunks.push(makeChunk(chunkIdx++, lines.slice(bufStart, cutAt).join("\n"), bufStart + 1));
      bufStart = cutAt;
    }
  }

  // Flush remainder
  if (bufStart < lines.length) {
    chunks.push(makeChunk(chunkIdx++, lines.slice(bufStart).join("\n"), bufStart + 1));
  }

  return chunks.length > 0 ? chunks : [makeChunk(0, code, 1)];
}

function makeChunk(index: number, text: string, startLine: number): FileChunk {
  const endLine = startLine + text.split("\n").length - 1;
  // Prepend a line-number gutter so the model can refer to lines accurately
  const numbered = text
    .split("\n")
    .map((l, i) => `${String(startLine + i).padStart(4, " ")} | ${l}`)
    .join("\n");
  return { index, startLine, endLine, text: numbered };
}
