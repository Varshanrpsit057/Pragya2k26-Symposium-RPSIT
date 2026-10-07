import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * The registration API (one Lambda function for every /api route, plus a 10-minute
 * schedule that retries failed Google syncs, passes and emails).
 *
 * Secrets are set per branch in the Amplify console (Hosting → Secrets) or, for a sandbox,
 * with `npx ampx sandbox secret set NAME`. Plain settings come from the Amplify
 * environment variables at build time (all optional).
 */
export const api = defineFunction({
  name: 'pragya-api',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 1024,
  // API Gateway waits at most 30 s for an answer.
  timeoutSeconds: 29,
  schedule: 'every 10m',
  environment: {
    GOOGLE_CLIENT_ID: secret('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: secret('GOOGLE_CLIENT_SECRET'),
    GOOGLE_REFRESH_TOKEN: secret('GOOGLE_REFRESH_TOKEN'),
    GOOGLE_SHEET_ID: secret('GOOGLE_SHEET_ID'),
    GOOGLE_DRIVE_PAYMENT_FOLDER_ID: secret('GOOGLE_DRIVE_PAYMENT_FOLDER_ID'),
    ADMIN_USERNAME: secret('ADMIN_USERNAME'),
    ADMIN_PASSWORD_HASH: secret('ADMIN_PASSWORD_HASH'),

    GOOGLE_SHEET_TAB: process.env.GOOGLE_SHEET_TAB || 'Registrations',
    GOOGLE_DRIVE_PASS_FOLDER_ID: process.env.GOOGLE_DRIVE_PASS_FOLDER_ID || '',
    GMAIL_SENDER: process.env.GMAIL_SENDER || '',
    MAIL_FROM_NAME: process.env.MAIL_FROM_NAME || 'PRAGYA 2026',
    MAIL_REPLY_TO: process.env.MAIL_REPLY_TO || '',
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || '300',
    RATE_LIMIT_WINDOW_MINUTES: process.env.RATE_LIMIT_WINDOW_MINUTES || '10',
  },
});
