import { describe, expect, it } from 'vitest';
import { clientIp, readConfig } from './config';

const required = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REFRESH_TOKEN: 'refresh-token',
  GOOGLE_SHEET_ID: 'sheet-id',
  GOOGLE_DRIVE_PAYMENT_FOLDER_ID: 'folder-id',
};

describe('readConfig', () => {
  it('names the missing settings and keeps registration off', () => {
    expect(readConfig({ GOOGLE_CLIENT_ID: 'x' })).toEqual({
      config: null,
      missing: ['GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_SHEET_ID', 'GOOGLE_DRIVE_PAYMENT_FOLDER_ID'],
    });
  });

  it('lets a whole college (100+ students on one shared IP, with retries) register by default', () => {
    const { rateLimit } = readConfig(required).config!;
    // Each student may send up to 3 requests (the browser retries twice when the server is busy).
    expect(rateLimit.max).toBeGreaterThanOrEqual(300);
    expect(rateLimit.windowMs).toBe(10 * 60_000);
  });

  it('rate-limits each student by their own address, also through the dev/preview proxy on this computer', () => {
    // The Vite proxy (same computer) passes the phone's address along.
    expect(clientIp({}, '192.168.1.23', '127.0.0.1')).toBe('192.168.1.23');
    expect(clientIp({}, '192.168.1.23, 127.0.0.1', '::1')).toBe('192.168.1.23');
    expect(clientIp({}, '', '::ffff:127.0.0.1')).toBe('::ffff:127.0.0.1');
    // Anyone else could make the header up, so it counts only behind a trusted proxy.
    expect(clientIp({}, '1.1.1.1', '203.0.113.9')).toBe('203.0.113.9');
    expect(clientIp({ TRUST_PROXY: 'yes' }, '1.1.1.1', '10.0.0.2')).toBe('1.1.1.1');
    expect(clientIp({}, undefined, undefined)).toBe('unknown');
  });

  it('reads overrides and keeps them within safe bounds', () => {
    const { config } = readConfig({ ...required, REGISTRATION_WORKERS: '50', RATE_LIMIT_MAX: '1000', GOOGLE_SHEET_TAB: ' Test ' });
    expect(config).toMatchObject({ workers: 8, rateLimit: { max: 1000 }, sheetTab: 'Test' });
  });
});
