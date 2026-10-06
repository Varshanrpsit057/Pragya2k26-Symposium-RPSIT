/**
 * Settings for the registration server, by name (see .env.example).
 *
 * Locally they come from .env. The Google client, refresh token, Sheet and Drive IDs are
 * secrets: they stay on the server and are never sent to the browser.
 */

/** Setting values by name: process.env for the local server, bindings on Cloudflare. */
export type Settings = Readonly<Record<string, unknown>>;

export interface DeskConfig {
  google: { clientId: string; clientSecret: string; refreshToken: string };
  sheetId: string;
  sheetTab: string;
  paymentFolderId: string;
  /** Where participant passes go; null: a "Participant Passes" folder next to the payment folder. */
  passFolderId: string | null;
  mail: { fromName: string; sender: string | null; replyTo: string | null };
  workers: number;
  rateLimit: { max: number; windowMs: number };
}

const REQUIRED = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_SHEET_ID',
  'GOOGLE_DRIVE_PAYMENT_FOLDER_ID',
] as const;

const text = (value: unknown) => (typeof value === 'string' && value.trim()) || null;

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/** The settings, or the names of the missing ones (registration stays off until they are set). */
export function readConfig(env: Settings): { config: DeskConfig | null; missing: string[] } {
  const missing = REQUIRED.filter((name) => !text(env[name]));
  if (missing.length) return { config: null, missing };
  return {
    missing: [],
    config: {
      google: {
        clientId: text(env.GOOGLE_CLIENT_ID)!,
        clientSecret: text(env.GOOGLE_CLIENT_SECRET)!,
        refreshToken: text(env.GOOGLE_REFRESH_TOKEN)!,
      },
      sheetId: text(env.GOOGLE_SHEET_ID)!,
      sheetTab: text(env.GOOGLE_SHEET_TAB) ?? 'Registrations',
      paymentFolderId: text(env.GOOGLE_DRIVE_PAYMENT_FOLDER_ID)!,
      passFolderId: text(env.GOOGLE_DRIVE_PASS_FOLDER_ID),
      mail: {
        fromName: text(env.MAIL_FROM_NAME) ?? 'PRAGYA 2026',
        sender: text(env.GMAIL_SENDER),
        replyTo: text(env.MAIL_REPLY_TO),
      },
      // Google Drive takes about 3 uploads a second from one account; 3 at a time keeps
      // well inside that while each registration still finishes in a second or two.
      workers: integer(env.REGISTRATION_WORKERS, 3, 1, 8),
      rateLimit: {
        // Generous, because a whole college can share one IP address: 100 students, each
        // with up to 3 tries (the browser retries twice when the server is busy).
        max: integer(env.RATE_LIMIT_MAX, 300, 5, 10_000),
        windowMs: integer(env.RATE_LIMIT_WINDOW_MINUTES, 10, 1, 1440) * 60_000,
      },
    },
  };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The visitor's address, for rate limits. X-Forwarded-For counts only when it comes from a
 * proxy we trust: one on this computer (the Vite dev server and preview, which pass the phone's
 * address along), or any proxy when TRUST_PROXY is set. Anyone else could make it up.
 */
export function clientIp(env: Settings, forwardedFor: string | undefined, remoteAddress: string | undefined): string {
  const trusted = LOOPBACK.has(remoteAddress ?? '') || ['1', 'true', 'yes'].includes(String(env.TRUST_PROXY ?? '').toLowerCase());
  const forwarded = trusted ? String(forwardedFor ?? '').split(',')[0].trim() : '';
  return forwarded || remoteAddress || 'unknown';
}

/** Other websites allowed to call the API (the site itself always may), comma separated. */
export function allowedOrigins(env: Settings): string[] {
  return String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}
