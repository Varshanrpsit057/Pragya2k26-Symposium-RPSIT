/**
 * Compresses the API's answers for the browsers that accept it (all do): the staff lists are
 * JSON, which shrinks to a fraction, so every desk laptop and phone on the venue Wi-Fi gets
 * its refresh faster, and a long list stays far inside Lambda's 6 MB answer limit.
 */
import { gzipSync } from 'node:zlib';
import type { HttpResponse } from './http';

/** Below this, compressing saves too little to be worth it. */
const MIN_BYTES = 1024;

export interface EncodedResponse {
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

export function encodeResponse(response: HttpResponse, acceptEncoding: string | undefined): EncodedResponse {
  const accepts = /\bgzip\b/i.test(acceptEncoding ?? '');
  const headers = { ...response.headers, Vary: 'Accept-Encoding' };
  if (!accepts || Buffer.byteLength(response.body) < MIN_BYTES) return { headers, body: response.body, isBase64Encoded: false };
  return { headers: { ...headers, 'Content-Encoding': 'gzip' }, body: gzipSync(response.body).toString('base64'), isBase64Encoded: true };
}
