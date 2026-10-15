import auth from 'firebase-tools/lib/auth.js';
import api from 'firebase-tools/lib/api.js';
import { OAuth2Client } from 'google-auth-library';
import { Firestore } from '@google-cloud/firestore';
import { readFileSync } from 'node:fs';

// SDK errors can carry credential-bearing request objects. Print only the safe message.
process.on('uncaughtException', error => {
  console.error(error.response?.data?.error?.message || error.message || 'Firebase operation failed.');
  process.exit(1);
});

export function firebaseClients() {
  const projectId = JSON.parse(readFileSync('.firebaserc', 'utf8')).projects.default;
  if (projectId !== 'cadence-53781') throw Error('Unexpected Firebase project. Check .firebaserc before migrating data.');
  const index = process.argv.indexOf('--account');
  const account = index >= 0 ? auth.selectAccount(process.argv[index + 1], process.cwd()) : auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw Error('Sign in with firebase login:add first.');
  // Reuse the CLI login in memory. Never print or copy OAuth tokens to a file.
  const client = new OAuth2Client(api.clientId(), api.clientSecret());
  client.setCredentials(account.tokens);
  return {
    projectId, account: account.user.email, client,
    firestore: new Firestore({ projectId, authClient: client, preferRest: true })
  };
}
