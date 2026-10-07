/**
 * Where the registration API lives: the AWS API Gateway address baked in at build time
 * (see vite.config.ts), or '' for /api on this site's own address.
 */
export const API_BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export const apiUrl = (base: string, path: `/api/${string}`) => `${base}${path}`;
