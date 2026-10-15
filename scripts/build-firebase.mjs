import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { firebaseSourceHash } from './firebase-build-state.mjs';
const sourceHash = firebaseSourceHash();
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner'], { stdio: 'inherit', env: { ...process.env, VITE_DATA_MODE: 'firebase' } });
if (result.status === 0) {
  if (firebaseSourceHash() !== sourceHash) throw Error('Source changed during the build. Rebuild before deploying.');
  writeFileSync('dist/deployment.json', JSON.stringify({ mode: 'firebase-spark', projectId: 'cadence-53781', sourceHash, builtAt: new Date().toISOString() }) + '\n');
}
process.exit(result.status ?? 1);
