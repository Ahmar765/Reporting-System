import { openDb, migrate } from './db.js';
import { runJobs } from './scheduler.js';
const db = openDb();
migrate(db);
try {
  console.log(await runJobs(db));
} finally {
  db.close();
}
