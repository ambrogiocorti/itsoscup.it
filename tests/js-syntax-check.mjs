import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'vendor', '.agents']);

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else if (entry.endsWith('.js')) files.push(full);
  }
  return files;
}

function toParsableScript(source) {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g, '')
    .replace(/import\s+['"][^'"]+['"];\s*/g, '')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+(async\s+function|function|const|let|var|class)\s+/g, '$1 ')
    .replace(/export\s+\{[\s\S]*?\};\s*/g, '');
}

const files = walk(root);
assert(files.length > 0, 'No JavaScript files found.');

const failures = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  try {
    new vm.Script(toParsableScript(source), { filename: file });
  } catch (error) {
    failures.push(`${file}\n${error.message}`);
  }
}

assert.equal(failures.length, 0, failures.join('\n\n'));
console.log(`JavaScript syntax checks passed (${files.length} files).`);
