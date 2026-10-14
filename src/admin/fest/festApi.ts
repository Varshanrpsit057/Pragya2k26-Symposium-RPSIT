/** The fest's API calls (server/fest.ts). */
import type { FestCatalog, FestRegistration, FestResult, GateStudent, HandOver, UtrHolder } from '../../lib/fest';
import type { BackupStatus, PortalSettings } from '../../lib/portal';
import { request } from '../adminApi';

/** The switches the dashboards follow (Website controls): what is off is hidden, and refused by the server. */
export interface DashboardSwitches {
  deskRegistration: boolean;
  eventEntry: boolean;
  results: boolean;
  downloads: boolean;
  onlinePayment: boolean;
}
export const ALL_ON: DashboardSwitches = { deskRegistration: true, eventEntry: true, results: true, downloads: true, onlinePayment: true };

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

export interface ImportRow {
  row: number;
  name: string;
  phone: string;
  email: string;
  college: string;
  collegeCode: string;
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
/** "Who has this UTR?": everyone with it, in every department (the desks, when a UTR clashes). */
export const lookupUtr = (token: string, txn: string) => request<{ txn: string; holders: UtrHolder[] }>('/api/admin/fest/utr', { method: 'POST', body: { txn }, token });
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
/** A desk's cash hand-over (desks: their own desk; others name it). */
export const handOverCash = (token: string, body: { dept?: string; desk?: number; counted: number; note: string }) =>
  request<{ handOver: HandOver }>('/api/admin/fest/handover', { method: 'POST', body, token }).then((data) => data.handOver);
export const listHandOvers = (token: string) => request<{ handOvers?: HandOver[] }>('/api/admin/fest/handovers', { token }).then((data) => data.handOvers ?? []);
/** The gate pass check (non-technical events): every department's students, view only. */
export const gateList = (token: string) => request<{ students: GateStudent[]; serverTime: string }>('/api/admin/fest/gate', { token });
/** Backs up now (the private copy and the Google Sheet) and answers how it went. */
export const backupNow = (token: string) => request<{ backup: BackupStatus | null }>('/api/admin/fest/backup', { method: 'POST', body: {}, token }).then((data) => data.backup);
export const saveQr = (token: string, image: string | null) => request<PortalView>('/api/admin/portal/qr', { method: 'POST', body: image ? { image } : { remove: true }, token });
