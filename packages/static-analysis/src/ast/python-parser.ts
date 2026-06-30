export async function parsePythonAst(dir: string) {
  // TODO: Use ast-grep or tree-sitter to parse Python AST
  return { parsed: true, language: 'python', metrics: { complexity: 5 } };
}
