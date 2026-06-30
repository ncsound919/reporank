export async function parseNodeAst(dir: string) {
  // TODO: Use ts-morph or babel to parse Node AST
  return { parsed: true, language: 'node', metrics: { complexity: 10 } };
}
