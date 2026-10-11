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
 *   GET  /api/admin/session                 who is signed in, their role, the registration phase
 *
 * and the staff routes in STAFF_ROUTES below, each with the permission it needs
 * (src/lib/staff.ts). Every /api/admin route except login needs "Authorization: Bearer
 * <token>"; the server decides who may do what, never the browser. Errors are short JSON
 * messages, never stack traces.
 */
import type { Permission } from '../src/lib/staff';
import { describeError } from './google';
import { requireAnyPermission, requirePermission, type Actor } from './roles';
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

interface StaffContext {
  actor: Actor;
  body: unknown;
  /** The path's captured parts: registration IDs upper-cased, event ids and usernames as sent. */
  params: string[];
}

interface StaffRoute {
  method: 'GET' | 'POST';
  path: RegExp;
  /** Needed before the handler runs; event routes also check the event inside the handler. */
  permission: Permission | readonly Permission[];
  run: (service: Service, context: StaffContext) => Promise<unknown>;
}

const ID = '([A-Za-z0-9-]{1,20})';
const EVENT = '([a-z0-9-]{1,40})';
const USER = '([A-Za-z0-9._-]{1,40})';
const route_ = (pattern: string) => new RegExp(`^/api/admin${pattern}$`);

/** Every staff route and the permission it requires. */
export const STAFF_ROUTES: readonly StaffRoute[] = [
  // Registrations (desk and admins)
  { method: 'GET', path: route_('/registrations'), permission: 'registrations.list', run: (s) => s.adminList() },
  { method: 'GET', path: route_(`/registrations/${ID}`), permission: 'registrations.list', run: (s, { params: [id] }) => s.view(id) },
  { method: 'GET', path: route_(`/registrations/${ID}/screenshot`), permission: 'registrations.approve', run: (s, { params: [id] }) => s.adminScreenshot(id) },
  { method: 'GET', path: route_(`/registrations/${ID}/pass`), permission: 'registrations.pass', run: (s, { params: [id] }) => s.adminPass(id) },
  {
    method: 'GET',
    path: route_(`/registrations/${ID}/proofs/([a-z0-9-]{6,40})`),
    permission: ['registrations.list', 'registrations.approve'],
    run: (s, { actor, params: [id, proofId] }) => s.proofUrl(id, proofId, actor),
  },
  { method: 'POST', path: route_(`/registrations/${ID}/approve`), permission: 'registrations.approve', run: (s, { actor, body, params: [id] }) => s.approve(id, actor, body) },
  { method: 'POST', path: route_(`/registrations/${ID}/reject`), permission: 'registrations.approve', run: (s, { actor, body, params: [id] }) => s.reject(id, actor, body) },
  { method: 'POST', path: route_(`/registrations/${ID}/retry`), permission: 'registrations.retry', run: (s, { actor, body, params: [id] }) => s.retry(id, actor, body) },
  { method: 'POST', path: route_(`/registrations/${ID}/cancel`), permission: 'registrations.remove', run: (s, { actor, body, params: [id] }) => s.cancel(id, actor, body) },
  { method: 'POST', path: route_(`/registrations/${ID}/delete`), permission: 'registrations.remove', run: (s, { actor, body, params: [id] }) => s.deleteRegistration(id, actor, body) },
  { method: 'POST', path: route_(`/registrations/${ID}/details`), permission: 'registrations.edit', run: (s, { actor, body, params: [id] }) => s.editDetails(actor, id, body) },
  { method: 'POST', path: route_(`/registrations/${ID}/events`), permission: 'registrations.events', run: (s, { actor, body, params: [id] }) => s.changeEvents(actor, id, body) },
  { method: 'POST', path: route_('/onsite'), permission: 'registrations.onsite', run: (s, { actor, body }) => s.registerOnsite(actor, body) },

  // Events (coordinators, admins; the certificate team reads)
  { method: 'GET', path: route_(`/lookup/${ID}`), permission: 'events.operate', run: (s, { actor, params: [id] }) => s.events.lookup(actor, id) },
  { method: 'GET', path: route_('/events'), permission: ['events.operate', 'results.view'], run: (s, { actor }) => s.events.listEvents(actor) },
  { method: 'GET', path: route_(`/events/${EVENT}`), permission: ['events.operate', 'results.view'], run: (s, { actor, params: [eventId] }) => s.events.roster(actor, eventId) },
  {
    method: 'POST',
    path: route_(`/events/${EVENT}/registrations/${ID}/enroll`),
    permission: 'events.operate',
    run: (s, { actor, body, params: [eventId, id] }) => s.events.enroll(actor, eventId, id, body),
  },
  {
    method: 'POST',
    path: route_(`/events/${EVENT}/registrations/${ID}/fee`),
    permission: 'events.operate',
    run: (s, { actor, body, params: [eventId, id] }) => s.events.recordFee(actor, eventId, id, body),
  },
  {
    method: 'POST',
    path: route_(`/events/${EVENT}/registrations/${ID}/fee-screenshot`),
    permission: 'events.operate',
    run: (s, { actor, body, params: [eventId, id] }) => s.events.approveFeeScreenshot(actor, eventId, id, body),
  },
  {
    method: 'POST',
    path: route_(`/events/${EVENT}/registrations/${ID}/void-fee`),
    permission: 'events.correct',
    run: (s, { actor, body, params: [eventId, id] }) => s.events.voidFee(actor, eventId, id, body),
  },
  {
    method: 'POST',
    path: route_(`/events/${EVENT}/registrations/${ID}/attendance`),
    permission: 'events.operate',
    run: (s, { actor, body, params: [eventId, id] }) => s.events.markAttendance(actor, eventId, id, body),
  },
  { method: 'POST', path: route_(`/events/${EVENT}/winners`), permission: 'events.operate', run: (s, { actor, body, params: [eventId] }) => s.events.saveWinners(actor, eventId, body) },
  { method: 'POST', path: route_(`/events/${EVENT}/submit`), permission: 'events.operate', run: (s, { actor, params: [eventId] }) => s.events.submit(actor, eventId) },
  { method: 'POST', path: route_(`/events/${EVENT}/reopen`), permission: 'events.correct', run: (s, { actor, body, params: [eventId] }) => s.events.reopen(actor, eventId, body) },

  // Staff accounts and reports (admins)
  { method: 'GET', path: route_('/staff'), permission: 'staff.manage', run: (s) => s.staff.list() },
  { method: 'POST', path: route_('/staff'), permission: 'staff.manage', run: (s, { actor, body }) => s.staff.create(actor, body) },
  { method: 'POST', path: route_(`/staff/${USER}`), permission: 'staff.manage', run: (s, { actor, body, params: [username] }) => s.staff.update(actor, username, body) },
  { method: 'GET', path: route_('/reports'), permission: 'reports.view', run: (s, { actor }) => s.report(actor) },
  { method: 'GET', path: route_('/student-portal'), permission: 'portal.manage', run: (s) => s.students.adminState() },
  { method: 'GET', path: route_('/sessions'), permission: 'staff.manage', run: (s) => s.signedIn() },
  { method: 'GET', path: route_('/help'), permission: 'help.manage', run: (s) => s.help.list() },
  { method: 'POST', path: route_('/help/([a-z0-9-]{6,40})'), permission: 'help.manage', run: (s, { actor, body, params: [id] }) => s.help.update(actor, id, body) },
  { method: 'GET', path: route_('/system'), permission: 'system.view', run: (s) => s.systemStatus() },
  { method: 'POST', path: route_('/student-portal'), permission: 'portal.manage', run: (s, { actor, body }) => s.students.set(actor, body) },
];

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
      case '/api/student/portal':
        result = await get(() => service.students.state());
        break;
      case '/api/student':
        result = await post((body) => service.students.view(body, request.ip));
        break;
      case '/api/student/pass':
        result = await post((body) => service.students.pass(body, request.ip));
        break;
      case '/api/help/mine':
        result = await get(async () => service.help.mine(await service.authenticate(request.headers.authorization)));
        break;
      case '/api/student/upload':
        result = await post((body) => service.students.uploadTicket(body, request.ip));
        break;
      case '/api/student/proof':
        result = await post((body) => service.students.addProof(body, request.ip));
        break;
      case '/api/help': {
        // Signed-in senders are named from their account; anyone may send (they may be unable to sign in).
        const actor = request.headers.authorization ? await service.authenticate(request.headers.authorization).catch(() => null) : null;
        result = await post((body) => service.help.submit(body, request.ip, actor));
        break;
      }
      case '/api/admin/login':
        result = await post((body) => service.login(body, request.ip));
        break;
      case '/api/admin/logout':
        result = await post(() => service.logout(request.headers.authorization));
        break;
      case '/api/admin/session':
        result = await get(async () => service.sessionInfo(await service.authenticate(request.headers.authorization)));
        break;
      case '/api/admin/session/desk':
        result = await post((body) => service.setDeskNumber(request.headers.authorization, body));
        break;
      default: {
        const matches = STAFF_ROUTES.map((candidate) => ({ candidate, found: candidate.path.exec(path) })).filter(({ found }) => found);
        if (!matches.length) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
        const match = matches.find(({ candidate }) => candidate.method === method);
        if (!match) throw new ApiError(405, 'METHOD_NOT_ALLOWED', `Use ${matches[0].candidate.method}.`);
        const { candidate, found } = match;
        const actor = await service.authenticate(request.headers.authorization);
        const body = method === 'POST' ? readJson(request) : undefined;
        if (typeof candidate.permission === 'string') requirePermission(actor, candidate.permission);
        else requireAnyPermission(actor, candidate.permission);
        // Registration IDs are case-insensitive; event ids and usernames are lower-case already.
        const params = found!.slice(1).map((part) => (/^prg26-/i.test(part) ? part.toUpperCase() : part));
        result = await candidate.run(service, { actor, body, params });
      }
    }
    return json(200, result);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        error.status,
        {
          success: false,
          error: error.message,
          code: error.code,
          ...(error.fieldErrors && { fieldErrors: error.fieldErrors }),
          ...(error.details && { details: error.details }),
        },
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
