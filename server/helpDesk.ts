/**
 * Contact admin: any student coordinator, signed in or not (the problem may be that they
 * cannot sign in), sends a help request from the dashboard; admins and the web assistant team
 * see the requests and mark them resolved. Sending is open, so it is rate-limited.
 */
import { HELP_CATEGORIES, isHelpCategory, type HelpReply, type HelpRequest } from '../src/lib/help';
import { REGISTRATION_ID } from '../src/lib/registration';
import { ApiError } from './errors';
import type { Actor } from './roles';
import type { Store } from './store';

export interface HelpDeskDeps {
  store: Store;
  now: () => number;
  log: (message: string, details?: Record<string, unknown>) => void;
  /** True while a test session is on: requests sent then are test data. */
  testing?: () => Promise<boolean>;
}

/** Per network address (the desks share the college's), and for everyone together. */
const ADDRESS_LIMIT = { max: 30, windowMs: 10 * 60_000 };
const OVERALL_LIMIT = { max: 200, windowMs: 10 * 60_000 };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** One line, no control characters, at most `max` long. */
const line = (body: unknown, name: string, max: number) =>
  isObject(body) && typeof body[name] === 'string' ? (body[name] as string).replace(/\p{Cc}+/gu, ' ').trim().slice(0, max) : '';
const text = (body: unknown, name: string, max: number) =>
  isObject(body) && typeof body[name] === 'string' ? (body[name] as string).replace(/[^\P{Cc}\n]+/gu, ' ').trim().slice(0, max) : '';

export class HelpDesk {
  constructor(private readonly deps: HelpDeskDeps) {}

  private async limit(key: string, { max, windowMs }: { max: number; windowMs: number }) {
    const now = this.deps.now();
    if ((await this.deps.store.hit(key, windowMs, now)) > max) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many help requests right now. Please call the admin instead.', undefined, 60);
    }
  }

  /** A new help request; `actor` when the sender is signed in. */
  async submit(body: unknown, ip: string, actor: Actor | null): Promise<{ success: true; id: string }> {
    await this.limit('help-all', OVERALL_LIMIT);
    await this.limit(`help-ip:${ip}`, ADDRESS_LIMIT);
    const category = isObject(body) ? body.category : undefined;
    if (!isHelpCategory(category)) throw new ApiError(400, 'INVALID', `Choose what the problem is: ${Object.values(HELP_CATEGORIES).join(', ')}.`);
    const message = text(body, 'message', 1000);
    if (message.length < 5) throw new ApiError(400, 'INVALID', 'Describe the problem in a few words.');
    const name = actor?.displayName ?? line(body, 'name', 60);
    if (name.length < 2) throw new ApiError(400, 'INVALID', 'Enter your name, so the admin knows who to help.');
    const registrationId = line(body, 'registrationId', 20).toUpperCase();
    if (registrationId && !REGISTRATION_ID.test(registrationId)) throw new ApiError(400, 'INVALID', 'The Registration ID should look like 262007.');

    const now = this.deps.now();
    const request: HelpRequest = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date(now).toISOString(),
      category,
      message,
      name,
      contact: line(body, 'contact', 80) || null,
      username: actor?.username ?? null,
      registrationId: registrationId || null,
      page: line(body, 'page', 80) || null,
      status: 'OPEN',
      ...((await this.deps.testing?.()) && { test: true }),
    };
    await this.deps.store.saveHelpRequest(request);
    this.deps.log('Help request', { id: request.id, category, by: request.username ?? 'signed out' });
    return { success: true, id: request.id };
  }

  async list(): Promise<{ success: true; requests: HelpRequest[] }> {
    return { success: true, requests: await this.deps.store.listHelpRequests() };
  }

  /** The requests this student coordinator sent, with the answers they got. */
  async mine(actor: Actor): Promise<{ success: true; requests: HelpRequest[] }> {
    return { success: true, requests: (await this.deps.store.listHelpRequests()).filter((request) => request.username === actor.username) };
  }

  /**
   * Answers a request (the sender sees the reply under Contact admin) and/or marks it
   * resolved or open again. Either a reply or a status is needed.
   */
  async update(actor: Actor, id: string, body: unknown): Promise<{ success: true; request: HelpRequest }> {
    const current = await this.deps.store.getHelpRequest(id);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'There is no such help request.');
    const status = isObject(body) ? body.status : undefined;
    if (status !== undefined && status !== 'OPEN' && status !== 'RESOLVED') throw new ApiError(400, 'INVALID', 'Mark the request open or resolved.');
    const reply = text(body, 'reply', 1000);
    if (!reply && status === undefined) throw new ApiError(400, 'INVALID', 'Write a reply, or mark the request resolved.');
    const at = new Date(this.deps.now()).toISOString();
    const replies: HelpReply[] = [...(current.replies ?? []), ...(reply ? [{ by: actor.displayName, at, text: reply }] : [])];
    const next = status ?? current.status;
    const request: HelpRequest = {
      ...current,
      status: next,
      replies,
      ...(next === 'RESOLVED' ? { resolvedBy: current.resolvedBy && current.status === 'RESOLVED' ? current.resolvedBy : actor.username, resolvedAt: current.status === 'RESOLVED' ? current.resolvedAt : at } : { resolvedBy: undefined, resolvedAt: undefined }),
    };
    await this.deps.store.saveHelpRequest(request);
    this.deps.log('Help request updated', { id, status: next, replied: Boolean(reply), by: actor.username });
    return { success: true, request };
  }
}
