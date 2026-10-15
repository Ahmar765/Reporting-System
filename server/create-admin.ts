import { createInterface } from 'node:readline/promises';
import { openDb, migrate } from './db.js';
import { createAdmin } from './auth.js';
import { z } from 'zod/v4';
// JSON via stdin supports secret-manager piping; passwords never enter argv or logs.
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});
console.log('Provide one JSON line on stdin: email, name, password (minimum 12 characters).');
try {
  for await (const line of rl) {
    const v = z.object({
      email: z.email(),
      name: z.string().min(2),
      password: z.string().min(12).max(128)
    }).parse(JSON.parse(line));
    const db = openDb();
    migrate(db);
    await createAdmin(db, v.email, v.name, v.password);
    db.close();
    console.log('Initial administrator created.');
    break;
  }
} catch {
  console.error('Admin creation failed. Check input and whether an administrator already exists.');
  process.exitCode = 1;
} finally {
  rl.close();
}
