import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

const required = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REFRESH_TOKEN: 'refresh-token',
  GOOGLE_SHEET_ID: 'sheet-id',
  GOOGLE_DRIVE_PAYMENT_FOLDER_ID: 'folder-id',
  ADMIN_USERNAME: 'pragya-admin',
  ADMIN_PASSWORD_HASH: 'scrypt$32768$8$1$salt$hash',
  REGISTRATIONS_TABLE: 'Registrations',
  CONTROL_TABLE: 'Control',
  FILES_BUCKET: 'private-files',
};

describe('readConfig', () => {
  it('names the missing settings and keeps the API off', () => {
    expect(readConfig({ GOOGLE_CLIENT_ID: 'x' })).toEqual({
      config: null,
      missing: [
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REFRESH_TOKEN',
        'GOOGLE_SHEET_ID',
        'GOOGLE_DRIVE_PAYMENT_FOLDER_ID',
        'ADMIN_USERNAME',
        'ADMIN_PASSWORD_HASH',
        'REGISTRATIONS_TABLE',
        'CONTROL_TABLE',
        'FILES_BUCKET',
      ],
    });
  });

  it('treats an Amplify secret it could not resolve as missing', () => {
    const { missing } = readConfig({ ...required, ADMIN_PASSWORD_HASH: '<value will be resolved during runtime>' });
    expect(missing).toEqual(['ADMIN_PASSWORD_HASH']);
  });

  it('lets a whole college (100+ students on one shared IP, with retries) register by default', () => {
    const { rateLimit } = readConfig(required).config!;
    expect(rateLimit.max).toBeGreaterThanOrEqual(300);
    expect(rateLimit.windowMs).toBe(10 * 60_000);
  });

  it('reads overrides and keeps them within safe bounds', () => {
    const { config } = readConfig({ ...required, RATE_LIMIT_MAX: '1', GOOGLE_SHEET_TAB: ' Test ', GMAIL_SENDER: '' });
    expect(config).toMatchObject({ rateLimit: { max: 5 }, sheetTab: 'Test', mail: { sender: null, fromName: 'PRAGYA 2026' } });
    expect(config).toMatchObject({ tables: { registrations: 'Registrations', control: 'Control' }, bucket: 'private-files' });
  });
});
