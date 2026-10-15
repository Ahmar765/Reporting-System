import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
export function firebaseSourceHash() {
  const files = [];
  const visit = directory => { for (const e of readdirSync(directory, { withFileTypes: true })) { const path = directory + '/' + e.name; if (e.isDirectory()) visit(path); else files.push(path); } };
  for (const directory of ['src', 'shared', 'server/migrations']) visit(directory);
  files.push('server/query.ts', 'server/domain.ts', 'server/calendar.ts', 'server/validation.ts', 'package.json', 'npm-shrinkwrap.json', 'vite.config.ts', 'scripts/prepare-spark-source.mjs');
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
  return hash.digest('hex');
}
