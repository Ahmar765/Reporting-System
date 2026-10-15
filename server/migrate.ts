import { openDb, migrate } from './db.js';
const db = openDb();
migrate(db);
db.close();
console.log('Database migrations applied.');
