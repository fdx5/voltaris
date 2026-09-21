import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { digest, hashPassword, verifyPassword, sessionToken, issueSession } from './auth.mjs';
import { userState, userStateQuery, userFromRows } from './db.mjs';
import { verify, gameVersion, canVerifyVersion } from './verify.mjs';
import { resolveLocale, t } from './i18n.mjs';

const ASSET_CDN = 'https://cdn.jsdelivr.net';
/** `message` is a key into server/i18n.mjs's MESSAGES, not prose - the final
 * error handler below translates it using the request's own locale. */
const fail = (status, key) => Object.assign(new Error(key), { status, key });
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
export async function createApp(
  db,
  { production = false, origin = '', verifier = verify, rateLimits = true } = {},
) {
  const app = express();
  const pendingSaves = new Map();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          // Models, textures and audio come from the jsDelivr mirror of the repo.
          imgSrc: ["'self'", 'data:', 'blob:', ASSET_CDN],
          mediaSrc: ["'self'", 'blob:', ASSET_CDN],
          // GLTFLoader's ImageBitmapLoader fetches embedded GLB textures via blob URLs.
          connectSrc: ["'self'", 'blob:', ASSET_CDN],
          workerSrc: ["'self'", 'blob:'],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', async (req, res, next) => {
    try {
      await db.execute('SELECT 1');
      res.json({ ok: true });
    } catch {
      next(fail(503, 'DB_NOT_READY'));
    }
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = origin || `${req.protocol}://${req.get('host')}`;
      const allowed = [
        expected,
        ...(!production ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
      ];
      if (
        req.get('X-Voltaris') !== '1' ||
        (req.get('origin') && !allowed.includes(req.get('origin'))) ||
        !req.is('application/json')
      )
        return next(fail(403, 'FORBIDDEN_REQUEST'));
    }
    next();
  });
  app.use('/api', express.json({ limit: '4mb' }));
  if (rateLimits)
    app.use(
      '/api',
      rateLimit({
        windowMs: 60000,
        limit: 180,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: (req) => ({ error: t(resolveLocale(req), 'RATE_LIMITED') }),
      }),
    );
  const authLimit = rateLimits
    ? rateLimit({
        windowMs: 15 * 60000,
        limit: 30,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: (req) => ({ error: t(resolveLocale(req), 'AUTH_RATE_LIMITED') }),
      })
    : (req, res, next) => next();
  const dummyHash = await hashPassword(randomUUID());
  const credentials = (req) => {
    const { username, password } = req.body || {};
    if (
      typeof username !== 'string' ||
      !/^[a-zA-Z0-9_]{3,24}$/.test(username) ||
      typeof password !== 'string' ||
      password.length < 4 ||
      password.length > 128
    )
      throw fail(400, 'CREDENTIALS_FORMAT');
    return { username: username.toLowerCase(), password };
  };
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const { username, password } = credentials(req),
      id = randomUUID();
    const passwordHash = await hashPassword(password);
    try {
      await db.execute({
        sql: 'INSERT INTO users(id,username,password_hash) VALUES (?,?,?)',
        args: [id, username, passwordHash],
      });
    } catch (e) {
      if (String(e.code).includes('CONSTRAINT')) throw fail(409, 'USERNAME_TAKEN');
      throw e;
    }
    await issueSession(db, res, id, production);
    res.status(201).json({ user: await userState(db, id) });
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const { username, password } = credentials(req);
    const user = (
      await db.execute({
        sql: 'SELECT id,password_hash FROM users WHERE username=?',
        args: [username],
      })
    ).rows[0];
    const valid = await verifyPassword(password, user?.password_hash || dummyHash);
    if (!user || !valid) throw fail(401, 'INVALID_CREDENTIALS');
    await issueSession(db, res, user.id, production);
    res.json({ user: await userState(db, user.id) });
  });
  app.use('/api', async (req, res, next) => {
    try {
      const token = sessionToken(req);
      const session =
        token &&
        (
          await db.execute({
            sql: 'SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?',
            args: [digest(token), Date.now()],
          })
        ).rows[0];
      if (!session) throw fail(401, 'LOGIN_REQUIRED');
      req.userId = session.user_id;
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/auth/me', async (req, res) => res.json({ user: await userState(db, req.userId) }));
  app.post('/api/auth/logout', async (req, res) => {
    await db.execute({
      sql: 'DELETE FROM sessions WHERE token_hash=?',
      args: [digest(sessionToken(req))],
    });
    res.clearCookie('voltaris_session', {
      httpOnly: true,
      sameSite: 'strict',
      secure: production,
      path: '/',
    });
    res.json({ ok: true });
  });
  app.post('/api/runs', async (req, res) => {
    const {
      stage,
      weapon,
      credits,
      practice = false,
      autoFire = true,
      previousRunId,
    } = req.body || {};
    if (
      !integer(stage, 1, 5) ||
      !['LASER', 'MISSILE', 'SPREAD'].includes(weapon) ||
      !integer(credits, 1, 15) ||
      typeof practice !== 'boolean' ||
      typeof autoFire !== 'boolean'
    )
      throw fail(400, 'INVALID_LAUNCH_CONFIG');
    const user = await userState(db, req.userId);
    if (stage > user.unlockedStage) throw fail(403, 'STAGE_LOCKED');
    const config = { stage, weapon, credits, practice, autoFire };
    if (previousRunId) {
      const previous = (
        await db.execute({
          sql: "SELECT loadout_json FROM game_runs WHERE id=? AND user_id=? AND stage_id=? AND status='clear' AND practice=0",
          args: [String(previousRunId), req.userId, stage - 1],
        })
      ).rows[0];
      if (!previous || practice) throw fail(400, 'INVALID_CONTINUE_RUN');
      config.loadout = JSON.parse(previous.loadout_json);
    }
    const id = randomUUID();
    await db.execute({
      sql: 'INSERT INTO game_runs(id,user_id,stage_id,practice,weapon,credits,config_json,game_version) VALUES (?,?,?,?,?,?,?,?)',
      args: [
        id,
        req.userId,
        stage,
        practice ? 1 : 0,
        weapon,
        credits,
        JSON.stringify(config),
        gameVersion,
      ],
    });
    res.status(201).json({ id, config });
  });
  app.post('/api/runs/:id/finish', async (req, res) => {
    const run = (
      await db.execute({
        sql: 'SELECT * FROM game_runs WHERE id=? AND user_id=?',
        args: [req.params.id, req.userId],
      })
    ).rows[0];
    if (!run) throw fail(404, 'RUN_NOT_FOUND');
    if (run.status !== 'started')
      return res.json({ user: await userState(db, req.userId), status: run.status });
    if (!canVerifyVersion(run.game_version)) throw fail(409, 'GAME_UPDATED');
    const fingerprint = digest(JSON.stringify([req.body?.events, req.body?.outcome]));
    const existing = pendingSaves.get(run.id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw fail(409, 'SAVE_IN_PROGRESS');
      return res.json(await existing.promise);
    }
    const save = async () => {
      const verificationStart = performance.now();
      const result = await verifier(JSON.parse(run.config_json), req.body?.events);
      const verificationMs = performance.now() - verificationStart;
      if (req.body?.outcome === 'clear' && result.status !== 'clear') {
        // A 422 here previously left no trace anywhere - the only way to
        // diagnose a genuine client/server replay divergence (as opposed to
        // this being the expected rejection of a tampered or truncated
        // replay) was to reproduce it blind. Logging the mismatch is cheap
        // and gives the next occurrence an actual paper trail.
        console.error(
          'CLEAR_VERIFICATION_FAILED',
          JSON.stringify({
            runId: run.id,
            userId: req.userId,
            stage: run.stage_id,
            config: run.config_json,
            eventCount: Array.isArray(req.body?.events) ? req.body.events.length : null,
            claimed: { outcome: req.body?.outcome },
            verified: {
              status: result.status,
              score: result.score,
              kills: result.kills,
              level: result.level,
              frames: result.frames,
            },
            verificationMs,
          }),
        );
        throw fail(422, 'CLEAR_VERIFICATION_FAILED');
      }
      const persistenceStart = performance.now();
      // One atomic round trip: persist, conditionally unlock, and read the committed result.
      const saved = await db.batch(
        [
          {
            sql: "UPDATE game_runs SET status=?,score=?,kills=?,seconds=?,level=?,credits_used=?,loadout_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='started'",
            args: [
              result.status,
              result.score,
              result.kills,
              result.seconds,
              result.level,
              result.creditsUsed,
              JSON.stringify(result.loadout),
              run.id,
              req.userId,
            ],
          },
          {
            sql: "INSERT OR IGNORE INTO stage_progress(user_id,stage_id,first_run_id) SELECT user_id,stage_id,id FROM game_runs WHERE id=? AND user_id=? AND status='clear' AND practice=0 AND changes()=1",
            args: [run.id, req.userId],
          },
          {
            sql: 'SELECT status FROM game_runs WHERE id=? AND user_id=?',
            args: [run.id, req.userId],
          },
          userStateQuery(req.userId),
        ],
        'write',
      );
      const persistenceMs = performance.now() - persistenceStart;
      return {
        user: userFromRows(saved[3].rows),
        status: saved[2].rows[0].status,
        timing: {
          verificationMs: Math.round(verificationMs),
          persistenceMs: Math.round(persistenceMs),
        },
      };
    };
    const promise = save();
    pendingSaves.set(run.id, { fingerprint, promise });
    try {
      const response = await promise;
      res.set(
        'Server-Timing',
        `verify;dur=${response.timing.verificationMs}, save;dur=${response.timing.persistenceMs}`,
      );
      res.json(response);
    } finally {
      pendingSaves.delete(run.id);
    }
  });
  app.get('/api/history', async (req, res) => {
    const page = Number(req.query.page || 1),
      stage = Number(req.query.stage || 0),
      username = String(req.query.username || '').toLowerCase(),
      sort = req.query.sort === 'score' ? 'score' : 'recent';
    if (!integer(page, 1, 100000) || !integer(stage, 0, 5) || username.length > 24)
      throw fail(400, 'SEARCH_INVALID');
    const args = [],
      conditions = [];
    if (stage) {
      conditions.push('r.stage_id=?');
      args.push(stage);
    }
    if (username) {
      conditions.push('u.username=?');
      args.push(username);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = sort === 'score' ? 'r.score DESC,r.id DESC' : 'r.started_at DESC,r.id DESC';
    const total = Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS count FROM game_runs r JOIN users u ON u.id=r.user_id ${where}`,
          args,
        })
      ).rows[0].count,
    );
    const rows = (
      await db.execute({
        sql: `SELECT r.id,u.username,r.stage_id AS stage,s.name AS stageName,r.practice,r.weapon,r.status,r.score,r.kills,r.seconds,r.level,r.credits_used AS credits,r.started_at AS startedAt,r.finished_at AS finishedAt FROM game_runs r JOIN users u ON u.id=r.user_id JOIN stages s ON s.id=r.stage_id ${where} ORDER BY ${order} LIMIT 20 OFFSET ?`,
        args: [...args, (page - 1) * 20],
      })
    ).rows;
    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / 20)) });
  });
  const guestbookRowSql =
    'SELECT g.id,u.username,g.message,g.created_at AS createdAt FROM guestbook_entries g JOIN users u ON u.id=g.user_id';
  app.get('/api/guestbook', async (req, res) => {
    const page = Number(req.query.page || 1);
    if (!integer(page, 1, 100000)) throw fail(400, 'SEARCH_INVALID');
    const total = Number(
      (await db.execute('SELECT COUNT(*) AS count FROM guestbook_entries')).rows[0].count,
    );
    const rows = (
      await db.execute({
        sql: `${guestbookRowSql} ORDER BY g.created_at DESC,g.id DESC LIMIT 20 OFFSET ?`,
        args: [(page - 1) * 20],
      })
    ).rows;
    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / 20)) });
  });
  const guestbookLimit = rateLimits
    ? rateLimit({
        windowMs: 10 * 60000,
        limit: 5,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: (req) => ({ error: t(resolveLocale(req), 'GUESTBOOK_RATE_LIMITED') }),
      })
    : (req, res, next) => next();
  app.post('/api/guestbook', guestbookLimit, async (req, res) => {
    const message = String(req.body?.message ?? '').trim();
    if (!message || message.length > 500 || message.split('\n').length > 8)
      throw fail(400, 'GUESTBOOK_INVALID');
    const id = randomUUID();
    await db.execute({
      sql: 'INSERT INTO guestbook_entries(id,user_id,message) VALUES (?,?,?)',
      args: [id, req.userId, message],
    });
    const row = (await db.execute({ sql: `${guestbookRowSql} WHERE g.id=?`, args: [id] }))
      .rows[0];
    res.status(201).json({ row });
  });
  app.use('/api', (req, res) =>
    res.status(404).json({ error: t(resolveLocale(req), 'API_NOT_FOUND'), code: 'API_NOT_FOUND' }),
  );
  app.use(
    express.static(resolve('dist/client'), {
      index: false,
      setHeaders: (res, path) => {
        if (path.includes('/assets/') || path.includes('\\assets\\'))
          res.set('Cache-Control', 'public, max-age=31536000, immutable');
        else res.set('Cache-Control', 'no-cache');
        // The link-preview card is fetched and re-hosted by other origins, so
        // it is the one asset that may not be same-origin locked.
        if (path.endsWith('og-cover.png')) res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );
  app.get('/{*path}', (req, res, next) => {
    if (req.path.includes('.')) return res.sendStatus(404);
    res.sendFile(resolve('dist/client/index.html'), (err) => {
      if (err) next(err);
    });
  });
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    // Never log request bodies, credentials or database connection details.
    if (status >= 500) console.error('Request failed:', req.method, req.path, status);
    const locale = resolveLocale(req);
    const key = status < 500 || status === 503 ? err.key || err.message : 'SERVER_ERROR';
    res.status(status).json({ error: t(locale, key), code: key });
  });
  return app;
}
