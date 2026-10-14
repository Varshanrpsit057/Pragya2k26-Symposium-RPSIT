/** The fest's API calls (server/fest.ts). */
import type { FestCatalog, FestRegistration, FestResult, FestSource, UtrHolder } from '../../lib/fest';
import type { BackupStatus, PortalSettings } from '../../lib/portal';
import { request } from '../adminApi';

/** The switches the dashboards follow (Website controls): what is off is hidden, and refused by the server. */
export interface DashboardSwitches {
  deskRegistration: boolean;
  eventEntry: boolean;
  results: boolean;
  downloads: boolean;
  onlinePayment: boolean;
  /** Students join only their own department's events (off: any department's). */
  ownDepartmentEvents: boolean;
}
export const ALL_ON: DashboardSwitches = { deskRegistration: true, eventEntry: true, results: true, downloads: true, onlinePayment: true, ownDepartmentEvents: true };

export interface SyncAnswer {
  full: boolean;
  departments: string[];
  registrations: FestRegistration[];
  results: FestResult[];
  cursor: string;
  catalogRevision: number;
  /** When test data was last deleted: a new value means "drop your copy and load afresh". */
  resetAt?: string | null;
  switches?: DashboardSwitches;
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
/** Deletes a batch of test registrations; `remaining` says how many are left for the next call. */
/** "Who does this UTR belong to?": everyone with it, in every department. */
export const lookupUtr = (token: string, txn: string) => request<{ txn: string; holders: UtrHolder[] }>('/api/admin/fest/utr', { method: 'POST', body: { txn }, token });
/** Gives the UTR to the student it belongs to (verified); whoever had it loses it, others are told. */
export const assignUtr = (token: string, txn: string, to: string) =>
  request<{ registration: FestRegistration; movedFrom: string | null; notFound: string[] }>('/api/admin/fest/utr/assign', { method: 'POST', body: { txn, to, confirmed: true }, token });
/** The load test: adds mock participants (TEST) up to 1,000 in all, a batch per call. */
export const seedFestTestData = (token: string, count?: number) =>
  request<{ added: number; total: number; remaining: number; cap: number }>('/api/admin/fest/test-data/seed', { method: 'POST', body: count ? { count } : {}, token });
export const clearFestTestData = (token: string, results: boolean) =>
  request<{ cleared: number; remaining?: number; results: number; restarted: string[] }>('/api/admin/fest/test-data/clear', { method: 'POST', body: { results }, token });

/** A change the outbox sends (path and body), answered with the registration or the results. */
export const festWrite = (token: string, path: `/api/admin/fest/${string}`, body: unknown) =>
  request<{ registration?: FestRegistration; result?: FestResult; replayed?: boolean }>(path, { method: 'POST', body, token });

/** Website controls (web assist team): the switches, the UPI account and the QR code picture. */
export interface PortalView {
  portal: PortalSettings;
  qr: string | null;
  /** How the last scheduled backups went (with the full view only). */
  backup?: BackupStatus | null;
}
export const fetchPortal = (token: string) => request<PortalView>('/api/admin/portal', { token });
export const savePortal = (token: string, portal: Partial<PortalSettings>) => request<PortalView>('/api/admin/portal', { method: 'POST', body: { portal }, token });
export const saveQr = (token: string, image: string | null) => request<PortalView>('/api/admin/portal/qr', { method: 'POST', body: image ? { image } : { remove: true }, token });
