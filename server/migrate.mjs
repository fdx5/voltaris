import { connectDb, migrate } from './db.mjs';
const db = await connectDb();
try {
  await migrate(db);
  console.log('Database ready: schema v1 and 5 stages.');
} finally {
  db.close();
}
