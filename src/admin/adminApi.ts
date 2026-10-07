/**
 * The admin dashboard's calls to the registration API. Sign-in returns a session token,
 * kept in sessionStorage (gone when the tab closes) and sent as a Bearer token; the server
 * checks it on every request, so nothing here decides who is an admin.
 */
import type { AdminRegistration } from '../lib/admin';
import { API_BASE, apiUrl } from '../lib/api';

const TOKEN_KEY = 'pragya-admin-session';

/** The session has ended (expired, signed out, or the password changed): sign in again. */
export class SignedOut extends Error {}

export function savedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the session lasts until the page is reloaded.
  }
}

async function request<T>(path: `/api/${string}`, { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(API_BASE, path), {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as ({ success: boolean; error?: string } & T) | null;
  if (response.status === 401 && token) {
    saveToken(null);
    throw new SignedOut(data?.error ?? 'Please sign in again.');
  }
  if (!response.ok || !data?.success) {
    // The gateway's own throttle answers without our JSON.
    if (response.status === 429 && !data?.error) throw new Error('The server is busy. Please wait a moment and try again.');
    throw new Error(data?.error ?? `The server answered ${response.status}.`);
  }
  return data;
}

export async function signIn(username: string, password: string): Promise<string> {
  const { token } = await request<{ token: string }>('/api/admin/login', { method: 'POST', body: { username, password } });
  saveToken(token);
  return token;
}

export async function signOut(token: string) {
  saveToken(null);
  await request('/api/admin/logout', { method: 'POST', body: {}, token }).catch(() => undefined);
}

export const currentAdmin = (token: string) => request<{ username: string; expiresAt: string }>('/api/admin/session', { token });

export const listRegistrations = (token: string) =>
  request<{ registrations: AdminRegistration[] }>('/api/admin/registrations', { token }).then((data) => data.registrations);

const action = (token: string, id: string, name: 'approve' | 'reject' | 'retry', body: unknown = {}) =>
  request<{ registration: AdminRegistration }>(`/api/admin/registrations/${encodeURIComponent(id)}/${name}`, {
    method: 'POST',
    body,
    token,
  }).then((data) => data.registration);

export const approve = (token: string, id: string) => action(token, id, 'approve');
export const reject = (token: string, id: string, reason: string) => action(token, id, 'reject', { reason });
export const retry = (token: string, id: string, resendEmail = false) => action(token, id, 'retry', { resendEmail });

/** Short-lived links (a few minutes) to the payment screenshot and the pass. */
export const screenshotUrl = (token: string, id: string) =>
  request<{ url: string }>(`/api/admin/registrations/${encodeURIComponent(id)}/screenshot`, { token }).then((data) => data.url);
export const passUrl = (token: string, id: string) =>
  request<{ url: string }>(`/api/admin/registrations/${encodeURIComponent(id)}/pass`, { token }).then((data) => data.url);
