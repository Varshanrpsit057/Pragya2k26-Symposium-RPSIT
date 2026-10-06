/**
 * OPTIONAL: PRAGYA 2026 on Cloudflare Workers (not used yet; the site runs on the Node
 * server in server/node.ts). Kept ready in case Cloudflare hosting is chosen: see
 * wrangler.jsonc.
 *
 * The website (dist/) is served from Cloudflare's edge as static assets; this Worker only
 * runs for /api/*. Registrations go to the same registration desk as on Node, here as a
 * single Durable Object.
 */
import logo from '../public/images/rpsit-logo-pass.jpg';
import { allowedOrigins, readConfig, type Settings } from './config';
import { Desk } from './desk';
import { DriveStore } from './drive';
import { sendMail } from './gmail';
import { GoogleClient } from './google';
import { SheetsStore } from './sheets';

interface Env extends Settings {
  readonly ASSETS: Fetcher;
  readonly DESK: DurableObjectNamespace;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

/** The browser may call the API from the site itself, or from an origin listed in ALLOWED_ORIGINS. */
function corsHeaders(request: Request, env: Env, url: URL): Record<string, string> | null {
  const origin = request.headers.get('Origin');
  if (!origin || origin === url.origin) return {};
  if (allowedOrigins(env).includes(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return null;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const cors = corsHeaders(request, env, url);
    if (!cors) return json(403, { success: false, error: 'This website is not allowed to use the registration API.' });
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // One desk for the whole symposium, placed near India.
    const desk = env.DESK.get(env.DESK.idFromName('pragya-2026'), { locationHint: 'apac' });
    let response: Response;

    if (url.pathname === '/api/register') {
      if (request.method !== 'POST') return json(405, { success: false, error: 'Use POST.' }, { ...cors, Allow: 'POST, OPTIONS' });
      if (!/^application\/json\b/i.test(request.headers.get('Content-Type') ?? '')) {
        return json(415, { success: false, error: 'Send the registration as JSON.' }, cors);
      }
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) {
        return json(413, { success: false, error: 'The upload is too large. Please use a screenshot of 5 MB or less.' }, cors);
      }
      response = await desk.fetch('https://desk/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-ip': request.headers.get('CF-Connecting-IP') ?? '' },
        body: request.body,
      });
    } else if (url.pathname === '/api/health' && request.method === 'GET') {
      response = await desk.fetch('https://desk/health');
    } else {
      return json(404, { success: false, error: 'Not found.' }, cors);
    }

    const result = new Response(response.body, response);
    for (const [name, value] of Object.entries(cors)) result.headers.set(name, value);
    return result;
  },
} satisfies ExportedHandler<Env>;

/** The Durable Object behind /api: builds the desk from the settings and hands requests to it. */
export class RegistrationDesk implements DurableObject {
  private readonly desk: Desk | null;
  private readonly missing: string[];

  constructor(state: DurableObjectState, env: Env) {
    const { config, missing } = readConfig(env);
    this.missing = missing;
    if (!config) {
      this.desk = null;
      return;
    }
    const google = new GoogleClient(config.google);
    this.desk = new Desk({
      sheets: new SheetsStore(google, config.sheetId, config.sheetTab),
      drive: new DriveStore(google),
      sendMail: (mime) => sendMail(google, mime),
      storage: state.storage,
      logo: new Uint8Array(logo),
      paymentFolderId: config.paymentFolderId,
      passFolderId: config.passFolderId,
      mail: config.mail,
      workers: config.workers,
      rateLimit: config.rateLimit,
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (this.desk) return this.desk.handle(request);
    console.log(JSON.stringify({ message: 'Registration is not configured', missing: this.missing }));
    return json(
      503,
      { success: false, code: 'NOT_CONFIGURED', error: "Online registration isn't open yet. Please try again later or contact the organisers." },
      { 'Retry-After': '300' },
    );
  }

  async alarm(): Promise<void> {
    await this.desk?.alarm();
  }
}
