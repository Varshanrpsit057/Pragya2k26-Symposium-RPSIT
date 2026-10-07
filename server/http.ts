/**
 * The registration API's routes, independent of how requests arrive (API Gateway on AWS,
 * plain objects in tests).
 *
 *   GET  /api/health
 *   POST /api/uploads                       a private upload for the payment screenshot
 *   POST /api/register                      a registration (stored as PENDING)
 *   POST /api/status                        a participant's own status (ID + private key)
 *   POST /api/pass                          their pass, only once APPROVED
 *
 *   POST /api/admin/login                   username + password → session token
 *   POST /api/admin/logout
 *   GET  /api/admin/session
 *   GET  /api/admin/registrations
 *   GET  /api/admin/registrations/:id/screenshot
 *   GET  /api/admin/registrations/:id/pass
 *   POST /api/admin/registrations/:id/approve | reject | retry
 *
 * Every /api/admin route except login needs "Authorization: Bearer <token>"; the server
 * decides who is an admin, never the browser. Errors are short JSON messages, never stack traces.
 */
import { describeError } from './google';
import { ApiError, type Service } from './service';

export interface HttpRequest {
  method: string;
  path: string;
  /** Header names in lower case. */
  headers: Readonly<Record<string, string | undefined>>;
  body: string | null;
  /** The caller's address, as seen by API Gateway. */
  ip: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const ADMIN_ACTION = /^\/api\/admin\/registrations\/([A-Za-z0-9-]{1,20})\/(approve|reject|retry|screenshot|pass)$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => ({
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  },
  body: JSON.stringify(body),
});

function readJson(request: HttpRequest): unknown {
  if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
    throw new ApiError(415, 'UNSUPPORTED', 'Send the request as JSON.');
  }
  const text = request.body ?? '';
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new ApiError(413, 'TOO_LARGE', 'The request is too large.');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new ApiError(400, 'INVALID', 'The request could not be read. Please refresh the page and try again.');
  }
}

/**
 * Answers one request. `service` is null when the API is not configured yet (missing
 * secrets); every route then answers 503 so the website can say registration is not open.
 */
export async function route(
  request: HttpRequest,
  service: Service | null,
  log: (message: string, details?: Record<string, unknown>) => void = (message, details) =>
    console.log(JSON.stringify({ message, ...details })),
): Promise<HttpResponse> {
  const { method, path } = request;
  try {
    if (!service) {
      throw new ApiError(503, 'NOT_CONFIGURED', "Online registration isn't open yet. Please try again later or contact the organisers.", undefined, 300);
    }
    const post = (handler: (body: unknown) => Promise<unknown>) => {
      if (method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
      return handler(readJson(request));
    };
    const get = (handler: () => Promise<unknown>) => {
      if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
      return handler();
    };
    const admin = () => service.authenticate(request.headers.authorization);

    let result: unknown;
    switch (path) {
      case '/api/health':
        result = await get(async () => ({ success: true, status: 'ready' }));
        break;
      case '/api/uploads':
        result = await post((body) => service.createUpload(body, request.ip));
        break;
      case '/api/register':
        result = await post((body) => service.register(body, request.ip));
        break;
      case '/api/status':
        result = await post((body) => service.status(body, request.ip));
        break;
      case '/api/pass':
        result = await post((body) => service.pass(body, request.ip));
        break;
      case '/api/admin/login':
        result = await post((body) => service.login(body, request.ip));
        break;
      case '/api/admin/logout':
        result = await post(() => service.logout(request.headers.authorization));
        break;
      case '/api/admin/session':
        result = await get(async () => {
          const session = await admin();
          return { success: true, username: session.username, expiresAt: new Date(session.expiresAt).toISOString() };
        });
        break;
      case '/api/admin/registrations':
        result = await get(async () => {
          await admin();
          return service.adminList();
        });
        break;
      default: {
        const match = ADMIN_ACTION.exec(path);
        if (!match) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
        const [, id, action] = match;
        const registrationId = id.toUpperCase();
        if (action === 'screenshot' || action === 'pass') {
          result = await get(async () => {
            await admin();
            return action === 'screenshot' ? service.adminScreenshot(registrationId) : service.adminPass(registrationId);
          });
        } else {
          result = await post(async (body) => {
            const session = await admin();
            if (action === 'approve') return service.approve(registrationId, session);
            if (action === 'reject') return service.reject(registrationId, session, body);
            return service.retry(registrationId, session, body);
          });
        }
      }
    }
    return json(200, result);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        error.status,
        { success: false, error: error.message, code: error.code, ...(error.fieldErrors && { fieldErrors: error.fieldErrors }) },
        error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {},
      );
    }
    log('Unexpected API error', { method, path, error: describeError(error) });
    return json(500, {
      success: false,
      code: 'INTERNAL',
      error: 'Something went wrong on our side. Please try again in a minute.',
    });
  }
}
