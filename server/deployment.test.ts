/**
 * Checks on the production setup itself: API Gateway answers 404 for any path it does not
 * list, so every public route of server/http.ts must be in amplify/backend.ts; and the
 * answers are compressed for browsers that accept it.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeResponse } from './compress';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('production setup', () => {
  it('lists every API route for API Gateway (with its method)', () => {
    const http = read('./http.ts');
    const backend = read('../amplify/backend.ts');
    const gateway = new Set([...backend.matchAll(/method: HttpMethod\.(GET|POST), path: '([^']+)'/g)].map(([, method, path]) => `${method} ${path}`));
    // The public routes (staff routes under /api/admin/ go through the {proxy+} routes).
    const routes = [...http.matchAll(/case '(\/api\/[^']+)':\s*\n\s*(?:\/\/[^\n]*\n\s*)*(?:const [^\n]*\n\s*)*result = await (get|post)\(/g)].map(([, path, verb]) => `${verb.toUpperCase()} ${path}`);
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) {
      const [method, path] = route.split(' ');
      const covered = gateway.has(route) || (path.startsWith('/api/admin/') && path !== '/api/admin/login' && gateway.has(`${method} /api/admin/{proxy+}`));
      expect(covered, `${route} is missing from amplify/backend.ts ROUTES`).toBe(true);
    }
  });

  it('compresses answers of a kilobyte or more for browsers that accept gzip', () => {
    const big = { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrations: Array.from({ length: 200 }, (_, n) => ({ registrationId: `2620${n}`, name: 'Student' })) }) };
    const encoded = encodeResponse(big, 'gzip, deflate, br');
    expect(encoded).toMatchObject({ isBase64Encoded: true, headers: { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } });
    const bytes = Buffer.from(encoded.body, 'base64');
    expect(bytes.length).toBeLessThan(Buffer.byteLength(big.body) / 5);
    expect(gunzipSync(bytes).toString()).toBe(big.body);
    // Small answers, or browsers without gzip, get the plain text.
    expect(encodeResponse({ ...big, body: '{"success":true}' }, 'gzip')).toMatchObject({ isBase64Encoded: false, body: '{"success":true}' });
    expect(encodeResponse(big, undefined)).toMatchObject({ isBase64Encoded: false, body: big.body });
  });
});
