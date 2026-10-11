/**
 * Settings for the registration API, by name (see .env.example).
 *
 * On AWS they are the Lambda function's environment: secrets (Google OAuth client and
 * refresh token, Sheet and Drive IDs, the admin login) come from Amplify secrets, the
 * table and bucket names from the Amplify backend. None of them ever reaches the browser.
 */

import { site } from '../src/content/site';
import { scheduleOf, scheduleProblem, type RegistrationSchedule } from '../src/lib/schedule';

/** Setting values by name (process.env on Lambda, a plain object in tests). */
export type Settings = Readonly<Record<string, string | undefined>>;

export interface AppConfig {
  google: { clientId: string; clientSecret: string; refreshToken: string };
  sheetId: string;
  sheetTab: string;
  paymentFolderId: string;
  /** Where participant passes go; null: a "Participant Passes" folder next to the payment folder. */
  passFolderId: string | null;
  mail: { fromName: string; sender: string | null; replyTo: string | null };
  admin: { username: string; passwordHash: string };
  rateLimit: { max: number; windowMs: number };
  tables: { registrations: string; control: string };
  bucket: string;
  /** When online and on-site registration are open (src/content/site.ts unless overridden). */
  schedule: RegistrationSchedule;
}

/**
 * Optional overrides of the registration schedule, for rehearsing the event day on a sandbox
 * backend (e.g. SCHEDULE_ONSITE_OPENS_AT=2026-10-12T09:00:00). Leave them unset in production:
 * the schedule in src/content/site.ts applies.
 */
export const SCHEDULE_SETTINGS = {
  onlineClosesAt: 'SCHEDULE_ONLINE_CLOSES_AT',
  onsiteOpensAt: 'SCHEDULE_ONSITE_OPENS_AT',
  onsiteClosesAt: 'SCHEDULE_ONSITE_CLOSES_AT',
} as const;

const REQUIRED = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_SHEET_ID',
  'GOOGLE_DRIVE_PAYMENT_FOLDER_ID',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
  'REGISTRATIONS_TABLE',
  'CONTROL_TABLE',
  'FILES_BUCKET',
] as const;

/** A set value, or null. Amplify's placeholder for a secret it could not read counts as unset. */
const text = (value: unknown) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed && !trimmed.startsWith('<value will be resolved') ? trimmed : null;
};

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/** The schedule, with any overrides; a bad override is reported, never silently ignored. */
function readSchedule(env: Settings): { schedule: RegistrationSchedule; problem: string | null } {
  const schedule = scheduleOf(site.registration);
  for (const [key, name] of Object.entries(SCHEDULE_SETTINGS) as [keyof RegistrationSchedule, string][]) {
    const value = text(env[name]);
    if (value) schedule[key] = value;
  }
  const problem = scheduleProblem(schedule);
  return { schedule, problem: problem && `SCHEDULE_* (${problem})` };
}

/** The settings, or the names of the missing ones (the API answers 503 until they are set). */
export function readConfig(env: Settings): { config: AppConfig | null; missing: string[] } {
  const { schedule, problem } = readSchedule(env);
  const missing: string[] = REQUIRED.filter((name) => !text(env[name]));
  if (problem) missing.push(problem);
  if (missing.length) return { config: null, missing };
  const required = (name: (typeof REQUIRED)[number]) => text(env[name])!;
  return {
    missing: [],
    config: {
      google: {
        clientId: required('GOOGLE_CLIENT_ID'),
        clientSecret: required('GOOGLE_CLIENT_SECRET'),
        refreshToken: required('GOOGLE_REFRESH_TOKEN'),
      },
      sheetId: required('GOOGLE_SHEET_ID'),
      sheetTab: text(env.GOOGLE_SHEET_TAB) ?? 'Registrations',
      paymentFolderId: required('GOOGLE_DRIVE_PAYMENT_FOLDER_ID'),
      passFolderId: text(env.GOOGLE_DRIVE_PASS_FOLDER_ID),
      mail: {
        fromName: text(env.MAIL_FROM_NAME) ?? 'PRAGYA 2026',
        sender: text(env.GMAIL_SENDER),
        replyTo: text(env.MAIL_REPLY_TO),
      },
      admin: { username: required('ADMIN_USERNAME'), passwordHash: required('ADMIN_PASSWORD_HASH') },
      rateLimit: {
        // Generous, because a whole college can share one IP address: 100 students, each
        // with a few tries (upload, submit, a retry when the network drops).
        max: integer(env.RATE_LIMIT_MAX, 300, 5, 10_000),
        windowMs: integer(env.RATE_LIMIT_WINDOW_MINUTES, 10, 1, 1440) * 60_000,
      },
      tables: { registrations: required('REGISTRATIONS_TABLE'), control: required('CONTROL_TABLE') },
      bucket: required('FILES_BUCKET'),
      schedule,
    },
  };
}
