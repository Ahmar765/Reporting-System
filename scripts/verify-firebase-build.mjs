import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { firebaseSourceHash } from './firebase-build-state.mjs';
if (!existsSync('dist/deployment.json') || !existsSync('dist/index.html')) throw Error('Run npm run build:firebase before deploying Hosting.');
const manifest = JSON.parse(readFileSync('dist/deployment.json', 'utf8'));
if (manifest.mode !== 'firebase-spark' || manifest.projectId !== 'cadence-53781') throw Error('This build is not the Firebase-only app.');
if (manifest.sourceHash !== firebaseSourceHash()) throw Error('The source changed since this build. Run npm run build:firebase again.');
for (const name of readdirSync('dist/assets').filter(n => n.endsWith('.js'))) {
  if (/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(readFileSync('dist/assets/' + name, 'utf8'))) throw Error('A private credential was found in the public build. Deployment stopped.');
}
console.log('Verified static Firebase build and public asset credential check.');
