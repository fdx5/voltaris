// Browser tests always use an isolated local DB, never the configured Turso account.
import { createClient } from '@libsql/client';
import { mkdir } from 'node:fs/promises';
import { migrate } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
await mkdir('.local', { recursive: true });
const db = createClient({ url: `file:.local/e2e-${process.pid}.db` });
await migrate(db);
const app = await createApp(db, { rateLimits: false });
const server = app.listen(4179, '127.0.0.1', () => console.log('Isolated E2E server ready'));
for (const s of ['SIGINT', 'SIGTERM'])
  process.once(s, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
