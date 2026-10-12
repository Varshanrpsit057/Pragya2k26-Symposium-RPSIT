import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * The registration API (one Lambda function for every /api route, plus a schedule every 30
 * minutes that backs up the fest's data, retries failed Google syncs, passes and emails, and
 * copies event-day changes to the Google Sheet).
 *
 * Secrets are set per branch in the Amplify console (Hosting → Secrets) or, for a sandbox,
 * with `npx ampx sandbox secret set NAME`. Plain settings come from the Amplify
 * environment variables at build time (all optional).
 *
 * Each secret is decrypted with AWS KMS whenever the function starts, so only the real
 * credentials are secrets. The identifiers (Google client ID, sheet and Drive folder IDs, the
 * owner's username) are better set as Amplify environment variables; until they are, the
 * secret of the same name is used.
 */
const identifier = (name: string) => process.env[name] || secret(name);
export const api = defineFunction({
  name: 'pragya-api',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 1024,
  // API Gateway waits at most 30 s for an answer.
  timeoutSeconds: 29,
  // Every 30 minutes: often enough for the backups and retries, and the function is not woken
  // (and its secrets decrypted) every few minutes through the night.
  schedule: 'every 30m',
  logging: { retention: '3 months' },
  environment: {
    // Credentials: always secrets.
    GOOGLE_CLIENT_SECRET: secret('GOOGLE_CLIENT_SECRET'),
    GOOGLE_REFRESH_TOKEN: secret('GOOGLE_REFRESH_TOKEN'),
    ADMIN_PASSWORD_HASH: secret('ADMIN_PASSWORD_HASH'),
    // Identifiers: environment variables when set (no decryption), otherwise secrets.
    GOOGLE_CLIENT_ID: identifier('GOOGLE_CLIENT_ID'),
    GOOGLE_SHEET_ID: identifier('GOOGLE_SHEET_ID'),
    GOOGLE_DRIVE_PAYMENT_FOLDER_ID: identifier('GOOGLE_DRIVE_PAYMENT_FOLDER_ID'),
    ADMIN_USERNAME: identifier('ADMIN_USERNAME'),

    GOOGLE_SHEET_TAB: process.env.GOOGLE_SHEET_TAB || 'Registrations',
    GOOGLE_DRIVE_PASS_FOLDER_ID: process.env.GOOGLE_DRIVE_PASS_FOLDER_ID || '',
    GMAIL_SENDER: process.env.GMAIL_SENDER || '',
    MAIL_FROM_NAME: process.env.MAIL_FROM_NAME || 'PRAGYA 2026',
    MAIL_REPLY_TO: process.env.MAIL_REPLY_TO || '',
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || '300',
    RATE_LIMIT_WINDOW_MINUTES: process.env.RATE_LIMIT_WINDOW_MINUTES || '10',
    // Only to rehearse the event day on a sandbox: unset, the schedule in src/content/site.ts
    // applies (online until 16 Oct 11:59 PM IST, on-site on 17 Oct, then closed).
    SCHEDULE_ONLINE_CLOSES_AT: process.env.SCHEDULE_ONLINE_CLOSES_AT || '',
    SCHEDULE_ONSITE_OPENS_AT: process.env.SCHEDULE_ONSITE_OPENS_AT || '',
    SCHEDULE_ONSITE_CLOSES_AT: process.env.SCHEDULE_ONSITE_CLOSES_AT || '',
  },
});
