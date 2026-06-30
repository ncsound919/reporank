import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(__dirname, "packages");

function walk(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "coverage") {
        results.push(...walk(full));
      } else if (entry.isFile() && entry.name.endsWith(".js") && full.includes("\\dist\\")) {
        results.push(full);
      }
    }
  } catch { /* skip */ }
  return results;
}

const jsFiles = walk(packagesDir);
let fixed = 0;

for (const fp of jsFiles) {
  let content = readFileSync(fp, "utf-8");
  const original = content;
  content = content.replace(/from\s+"(\.[^"]+)"/g, (_match, p1) => {
    if (p1.endsWith(".js")) return `from "${p1}"`;
    return `from "${p1}.js"`;
  });
  if (content !== original) {
    writeFileSync(fp, content);
    fixed++;
  }
}

console.log(`Fixed ${fixed} dist .js files with extensionless imports`);
