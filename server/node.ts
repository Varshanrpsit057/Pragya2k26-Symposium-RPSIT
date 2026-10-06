/**
 * The PRAGYA 2026 registration server on Node.js.
 *
 *   npm run server        build and start it on http://localhost:8787
 *
 * Serves the built website (dist/) and the registration API (/api/register, /api/health).
 * The Vite dev server (npm run dev) forwards /api here, so the form works while editing too.
 * Settings come from .env (see .env.example).
 *
 * The registration counter and the email outbox are kept in .data/desk.json: a few small
 * records, so restarts never reuse a Registration ID or lose an unsent confirmation email.
 * Everything about a registration itself lives in the Google Sheet.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { allowedOrigins, clientIp, readConfig } from './config';
import { Desk, type DeskStorage } from './desk';
import { DriveStore } from './drive';
import { sendMail } from './gmail';
import { GoogleClient } from './google';
import { SheetsStore } from './sheets';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENV_FILE = join(ROOT, '.env');
const DATA_FILE = join(ROOT, '.data', 'desk.json');
const DIST = join(ROOT, 'dist');
const LOGO = join(ROOT, 'public', 'images', 'rpsit-logo-pass.jpg');
const MAX_BODY_BYTES = 8 * 1024 * 1024;

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const log = (message: string, details: Record<string, unknown> = {}) => {
  const extra = Object.entries(details)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  console.log(`${new Date().toLocaleTimeString('en-IN', { hour12: false })}  ${message}${extra ? `  ${extra}` : ''}`);
};

// ---------------------------------------------------------------------------------------
// Storage for the desk: one JSON file, written atomically

class FileStorage implements DeskStorage {
  private values: Record<string, unknown> = {};
  private alarmAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  onAlarm: () => Promise<void> = async () => {};

  constructor(private readonly file: string) {
    if (!existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { values?: Record<string, unknown>; alarmAt?: number | null };
      this.values = saved.values ?? {};
      this.alarmAt = saved.alarmAt ?? null;
    } catch (error) {
      // Never refuse to start over this file: the sheet's highest Registration ID keeps IDs
      // unique, and rows marked PENDING put their emails back in the outbox.
      const aside = `${file}.unreadable-${Date.now()}`;
      renameSync(file, aside);
      log('The desk file could not be read; starting fresh from the Google Sheet', {
        movedTo: aside,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private save() {
    mkdirSync(join(this.file, '..'), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ values: this.values, alarmAt: this.alarmAt }, null, 1));
    // Windows briefly locks a file that antivirus or the search indexer is reading: wait and retry.
    for (let attempt = 1; ; attempt += 1) {
      try {
        renameSync(temporary, this.file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * attempt);
      }
    }
  }

  async get<T>(key: string) {
    return structuredClone(this.values[key]) as T | undefined;
  }

  async put<T>(key: string, value: T) {
    this.values[key] = structuredClone(value);
    this.save();
  }

  async delete(key: string) {
    const existed = key in this.values;
    delete this.values[key];
    this.save();
    return existed;
  }

  async list<T>({ prefix }: { prefix: string }) {
    const entries = Object.entries(this.values).filter(([key]) => key.startsWith(prefix));
    return new Map(entries.map(([key, value]) => [key, structuredClone(value) as T]));
  }

  async getAlarm() {
    return this.alarmAt;
  }

  async setAlarm(time: number) {
    this.alarmAt = time;
    this.save();
    this.arm();
  }

  /** Runs the alarm when it is due; a failed run is tried again a minute later. */
  arm() {
    if (this.timer) clearTimeout(this.timer);
    if (this.alarmAt === null) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      const due = this.alarmAt;
      this.alarmAt = null;
      this.save();
      try {
        await this.onAlarm();
      } catch (error) {
        log('Alarm failed; trying again in a minute', { error: error instanceof Error ? error.message : String(error) });
        if (this.alarmAt === null) await this.setAlarm((due ?? Date.now()) + 60_000);
      }
    }, Math.max(0, this.alarmAt - Date.now()));
    this.timer.unref?.();
  }
}

// ---------------------------------------------------------------------------------------
// The desk

const { config, missing } = readConfig(process.env);
const storage = new FileStorage(DATA_FILE);
let desk: Desk | null = null;

if (config) {
  const google = new GoogleClient(config.google);
  desk = new Desk({
    sheets: new SheetsStore(google, config.sheetId, config.sheetTab),
    drive: new DriveStore(google),
    sendMail: (mime) => sendMail(google, mime),
    storage,
    logo: new Uint8Array(readFileSync(LOGO)),
    paymentFolderId: config.paymentFolderId,
    passFolderId: config.passFolderId,
    mail: config.mail,
    workers: config.workers,
    rateLimit: config.rateLimit,
    log,
  });
  storage.onAlarm = () => desk!.alarm();
  storage.arm();
} else {
  log('Registration is OFF: these settings are missing in .env', { missing: missing.join(', ') });
}

// ---------------------------------------------------------------------------------------
// HTTP

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);
const gzipCache = new Map<string, { mtime: number; body: Buffer }>();

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

/** The built website, with long caching for fingerprinted files in /assets/. */
function serveStatic(request: IncomingMessage, response: ServerResponse) {
  if (!existsSync(DIST)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('The website is not built yet: run npm run build (or use npm run dev).');
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  let file = normalize(join(DIST, pathname));
  if (!file.startsWith(DIST + sep) && file !== DIST) {
    response.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const index = join(file, 'index.html');
    // Unknown pages get the one-page site; missing files (with an extension) are 404.
    file = existsSync(index) ? index : extname(pathname) ? '' : join(DIST, 'index.html');
  }
  if (!file || !existsSync(file)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  const extension = extname(file).toLowerCase();
  const stats = statSync(file);
  const etag = `W/"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'Content-Type': TYPES[extension] ?? 'application/octet-stream',
    'Cache-Control': pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : extension === '.html'
        ? 'no-cache'
        : 'public, max-age=3600',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers).end();
    return;
  }

  let body: Buffer = readFileSync(file);
  if (COMPRESSIBLE.has(extension) && /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) {
    const cached = gzipCache.get(file);
    if (cached?.mtime === stats.mtimeMs) body = cached.body;
    else {
      body = gzipSync(body, { level: 9 });
      gzipCache.set(file, { mtime: stats.mtimeMs, body });
    }
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = String(body.length);
  response.writeHead(200, headers);
  response.end(request.method === 'HEAD' ? undefined : body);
}

/** Reads the request body, refusing anything over the size limit. */
function readBody(request: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolveBody(null);
        request.pause();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string) {
  // The site itself (or the Vite dev server forwarding to us) may call the API, plus any
  // origin listed in ALLOWED_ORIGINS.
  const origin = request.headers.origin;
  const cors: Record<string, string> = {};
  if (origin) {
    const sameSite = (() => {
      try {
        return new URL(origin).host === request.headers.host;
      } catch {
        return false;
      }
    })();
    if (!sameSite) {
      if (!allowedOrigins(process.env).includes(origin)) {
        sendJson(response, 403, { success: false, error: 'This website is not allowed to use the registration API.' });
        return;
      }
      cors['Access-Control-Allow-Origin'] = origin;
      cors.Vary = 'Origin';
    }
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...cors,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    response.end();
    return;
  }

  if (!desk) {
    sendJson(
      response,
      503,
      { success: false, code: 'NOT_CONFIGURED', error: "Online registration isn't open yet. Please try again later or contact the organisers." },
      { ...cors, 'Retry-After': '300' },
    );
    return;
  }

  let deskRequest: Request;
  if (pathname === '/api/register') {
    if (request.method !== 'POST') return sendJson(response, 405, { success: false, error: 'Use POST.' }, { ...cors, Allow: 'POST, OPTIONS' });
    if (!/^application\/json\b/i.test(String(request.headers['content-type'] ?? ''))) {
      return sendJson(response, 415, { success: false, error: 'Send the registration as JSON.' }, cors);
    }
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      return sendJson(response, 413, { success: false, error: 'The upload is too large. Please use a screenshot of 5 MB or less.' }, { ...cors, Connection: 'close' });
    }
    const body = await readBody(request);
    if (!body) {
      return sendJson(response, 413, { success: false, error: 'The upload is too large. Please use a screenshot of 5 MB or less.' }, { ...cors, Connection: 'close' });
    }
    deskRequest = new Request('http://desk/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-ip': clientIp(process.env, request.headers['x-forwarded-for']?.toString(), request.socket.remoteAddress),
      },
      body: Uint8Array.from(body),
    });
  } else if (pathname === '/api/health' && request.method === 'GET') {
    deskRequest = new Request('http://desk/health');
  } else {
    return sendJson(response, 404, { success: false, error: 'Not found.' }, cors);
  }

  const result = await desk.handle(deskRequest);
  const headers: Record<string, string> = { ...cors };
  result.headers.forEach((value, name) => {
    headers[name] = value;
  });
  response.writeHead(result.status, headers);
  response.end(Buffer.from(await result.arrayBuffer()));
}

const server = createServer((request, response) => {
  const pathname = (request.url ?? '/').split('?')[0];
  const work = pathname.startsWith('/api/')
    ? handleApi(request, response, pathname)
    : Promise.resolve(serveStatic(request, response));
  work.catch((error: unknown) => {
    log('Request failed', { path: pathname, error: error instanceof Error ? error.message : String(error) });
    if (!response.headersSent) sendJson(response, 500, { success: false, error: 'Something went wrong. Please try again.' });
    else response.end();
  });
});
// Slow mobile uploads get two minutes; idle connections are closed quickly.
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;

const port = Number(process.env.PORT) || 8787;
// On a hosting platform (PORT is set) listen on every interface; locally only on this computer.
const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
server.on('error', (error: NodeJS.ErrnoException) => {
  log(
    error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use: the registration server is probably running already (open http://localhost:${port}/api/health), or set PORT in .env to use another port.`
      : `The registration server could not start: ${error.message}`,
  );
  process.exit(1);
});
server.listen(port, host, async () => {
  log(`PRAGYA 2026 registration server on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`, {
    registration: desk ? 'ON' : 'OFF',
    website: existsSync(DIST) ? 'dist/' : 'not built',
  });
  if (!desk || !config) return;
  log('Settings', {
    sheetTab: config.sheetTab,
    workers: config.workers,
    rateLimit: `${config.rateLimit.max} per ${config.rateLimit.windowMs / 60_000} min per IP`,
    sender: config.mail.sender ?? '(the signed-in Gmail account)',
  });
  // Connect to Google now rather than on the first student's submit.
  const ready = await desk.warmUp();
  if (ready.ok) log('Connected to the Google Sheet', { registrations: ready.registrations });
  else log('NOT connected to the Google Sheet yet; registrations will retry it. Run npm run google:check', { error: ready.error });
});

// One failed background task must not take registration down for everyone: log it and carry on.
process.on('unhandledRejection', (reason) => {
  log('Unhandled error in a background task', { error: reason instanceof Error ? reason.message : String(reason) });
});

const shutDown = () => {
  log('Stopping...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
// Ctrl+Break on Windows: how start.py asks the server to stop cleanly.
process.on('SIGBREAK', shutDown);
