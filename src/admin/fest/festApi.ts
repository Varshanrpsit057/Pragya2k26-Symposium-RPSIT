/** The fest's API calls (server/fest.ts). */
import type { FestCatalog, FestRegistration, FestResult, FestSource } from '../../lib/fest';
import { request } from '../adminApi';

export interface SyncAnswer {
  full: boolean;
  departments: string[];
  registrations: FestRegistration[];
  results: FestResult[];
  cursor: string;
  catalogRevision: number;
  serverTime: string;
}

export const festCatalog = (token: string) => request<{ catalog: FestCatalog }>('/api/admin/fest/catalog', { token }).then((data) => data.catalog);
export const saveFestCatalog = (token: string, catalog: FestCatalog, baseRevision: number) =>
  request<{ catalog: FestCatalog }>('/api/admin/fest/catalog', { method: 'POST', body: { catalog, baseRevision }, token }).then((data) => data.catalog);
export const festSync = (token: string, since: string, dept?: string) =>
  request<SyncAnswer>('/api/admin/fest/sync', { method: 'POST', body: { ...(since && { since }), ...(dept && { dept }) }, token });
export const takeIds = (token: string, body: { dept?: string; source?: FestSource; count?: number }) =>
  request<{ dept: string; source: FestSource; first: number; last: number }>('/api/admin/fest/blocks', { method: 'POST', body, token });

export interface ImportRow {
  row: number;
  name: string;
  phone: string;
  email: string;
  college: string;
  branch: string;
  year: string;
  team: string;
  events: string;
  ref: string;
}
export interface ImportOutcome {
  row: number;
  status: 'ok' | 'created' | 'duplicate' | 'error';
  id?: string;
  message?: string;
}
export const importFest = (token: string, body: { dept?: string; rows: ImportRow[]; dryRun: boolean; eventFeesPaid?: boolean }) =>
  request<{ outcomes: ImportOutcome[] }>('/api/admin/fest/import', { method: 'POST', body, token }).then((data) => data.outcomes);
export const clearFestTestData = (token: string, results: boolean) =>
  request<{ cleared: number; results: number; restarted: string[] }>('/api/admin/fest/test-data/clear', { method: 'POST', body: { results }, token });

/** A change the outbox sends (path and body), answered with the registration or the results. */
export const festWrite = (token: string, path: `/api/admin/fest/${string}`, body: unknown) =>
  request<{ registration?: FestRegistration; result?: FestResult; replayed?: boolean }>(path, { method: 'POST', body, token });
