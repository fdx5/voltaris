import 'dotenv/config';
import { connectDb, migrate } from './db.mjs';
import { createApp } from './app.mjs';
const db = await connectDb();
await migrate(db);
const app = await createApp(db, {
  production: process.env.NODE_ENV === 'production',
  origin: process.env.APP_ORIGIN || '',
});
const server = app.listen(Number(process.env.PORT || 3001), '0.0.0.0', () =>
  console.log(`VOLTARIS server listening on port ${process.env.PORT || 3001}`),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
