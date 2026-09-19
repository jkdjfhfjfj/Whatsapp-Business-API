import 'dotenv/config';
// MUST be imported before any routes are defined. Express 4 does not automatically forward
// errors thrown (or promises rejected) inside `async (req, res) => {...}` handlers to the error
// middleware — without this, such an error just hangs the request forever with no response at
// all (not a 500, not anything), which is exactly the "no response on success or error" symptom.
// This patches Express so those errors reach the error handler at the bottom of this file.
import 'express-async-errors';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import morgan from 'morgan';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './db/client.js';
import { authRouter } from './routes/auth.js';
import { wabaRouter } from './routes/waba.js';
import { aiRouter } from './routes/ai.js';
import { conversationsRouter } from './routes/conversations.js';
import { messagesRouter } from './routes/messages.js';
import { webhookRouter } from './routes/webhook.js';
import { uploadsRouter } from './routes/uploads.js';
import { tagsRouter } from './routes/tags.js';
import { notesRouter } from './routes/notes.js';
import { quickRepliesRouter } from './routes/quickReplies.js';
import { agentsRouter } from './routes/agents.js';
import { dashboardRouter } from './routes/dashboard.js';
import { initWebSocketServer } from './services/websocket.js';
import { ensureDefaultTenant } from './services/defaultTenant.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PgSession = connectPgSimple(session);

// Render (and most PaaS) terminate TLS at a proxy in front of the app, so Express sees plain
// HTTP internally. Without `trust proxy`, express-session can't tell the connection is actually
// HTTPS, so `cookie.secure: true` cookies silently fail to be set/sent — the exact bug that was
// causing repeated logouts ("deauthentication"). This must be set before the session middleware.
app.set('trust proxy', 1);

// CORS only matters when the client is served from a different origin (local dev with two
// separate dev servers). In the single-service Render deployment below, the browser and API
// share an origin, so this is effectively a no-op there.
app.use(cors({
  origin: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(','),
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// Logs every request as: METHOD path STATUS response-time-ms — visible in Render's log tab.
// This alone answers "did the request even arrive, and what did the server send back" for any
// 404/401/500 report, without needing to reproduce the bug live with someone watching.
morgan.token('business', (req) => (req as any).session?.businessId ?? '-');
app.use(morgan(':method :url :status :res[content-length] - :response-time ms (business=:business)'));

app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true, // sliding expiry — being active keeps you logged in
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
}));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (err) {
    // Distinguish "server process is up" from "server is up but can't reach the database" —
    // these look identical from the outside (both show as errors in the UI) but need different
    // fixes, so surface which one this is.
    console.error('[health] database check failed:', err);
    res.status(503).json({ ok: false, database: 'unreachable', error: (err as Error).message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/waba', wabaRouter);
app.use('/api/ai', aiRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/notes', notesRouter);
app.use('/api/quick-replies', quickRepliesRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/dashboard', dashboardRouter);
// Meta hits this directly (no /api prefix, no auth) — path must match what you configure in the
// Meta App Dashboard.
app.use('/webhook', webhookRouter);

// --- Single-service mode: serve the built React app for everything else ---
// `npm run build` at the project root builds client/dist and copies it to server/public.
// If that folder doesn't exist (e.g. you're only running the API in dev), we skip this and the
// client's own Vite dev server handles the UI instead.
const clientDist = path.join(__dirname, '..', 'public');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API, non-webhook GET request returns index.html so client-side
  // routing (React Router) works on a full page load/refresh.
  app.get(/^(?!\/api|\/webhook|\/health).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Anything under /api or /webhook that didn't match one of the routers above is a genuinely
// unmatched route (typo'd path, removed endpoint, client/server version mismatch, etc).
// Without this, Express's default 404 is a plain HTML page with no JSON body, which makes the
// client's error message a useless "Request failed (404)" — this makes the failure name itself.
app.use(['/api', '/webhook'], (req, res) => {
  res.status(404).json({ error: `No route matches ${req.method} ${req.originalUrl}` });
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Log with enough context to diagnose without reproducing live: which request, which user/
  // business, and the full stack — not just the message.
  console.error(
    `[error] ${req.method} ${req.originalUrl} (business=${req.session?.businessId ?? '-'} user=${req.session?.userId ?? '-'})`,
    err,
  );

  // Postgres "undefined_table" (42P01) — almost always means `npm run db:push` was never run
  // against this database, or you're pointed at the wrong DATABASE_URL. Every "relation ... does
  // not exist" error a person hits traces back to this, so name it instead of a generic 500.
  if (err?.code === '42P01') {
    return res.status(500).json({
      error: `Database table is missing (${err.message}). Run "npm run db:push" from the server ` +
        `directory against this DATABASE_URL to create the schema, then try again.`,
    });
  }
  // Postgres "undefined_column" (42703) — schema is out of date relative to the code, usually
  // after pulling new code without re-running db:push.
  if (err?.code === '42703') {
    return res.status(500).json({
      error: `Database schema is out of date (${err.message}). Run "npm run db:push" from the ` +
        `server directory to sync it with the current code, then try again.`,
    });
  }
  // Connection-level Postgres failures (wrong host/port/credentials, DB asleep, etc).
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' || err?.code === '28P01') {
    return res.status(503).json({
      error: `Could not reach the database (${err.code}). Check DATABASE_URL is correct and the ` +
        `database is running/awake.`,
    });
  }

  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : (err?.message ?? 'Internal server error.') });
});

const port = Number(process.env.PORT ?? 4000);
const server = http.createServer(app);
initWebSocketServer(server);

// Auth is removed, so there's no signup flow to create the first business/user anymore — this
// creates (or finds) the single default tenant every request gets attached to, once, before the
// server starts accepting traffic.
await ensureDefaultTenant();

server.listen(port, () => {
  console.log(`Listening on http://localhost:${port} (no authentication — anyone with this URL has full access)`);
});

