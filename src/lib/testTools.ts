/**
 * Test sessions, as the dashboard sees them (Testing, admins only): the timeline the website
 * follows, the session that marks what is made while testing, and the records it marked.
 * Types and plain data only: shared by the API and the dashboard.
 */
import type { RegistrationSchedule } from './schedule';

/** What an admin types to delete test data, so it is never done by a stray click. */
export const CLEAR_PHRASE = 'DELETE TEST DATA';

/** The quick timelines, plus a custom one and the real schedule. */
export type TimelineMode = 'standard' | 'onsite-now' | 'online-now' | 'closed' | 'custom';

export interface TimelineView {
  /** What the website and the API follow now. */
  schedule: RegistrationSchedule;
  /** The real schedule (src/content/site.ts). */
  standard: RegistrationSchedule;
  /** Set when a test timeline replaces the real one. */
  override: { mode: TimelineMode; setBy: string; setAt: string } | null;
  phase: 'online' | 'between' | 'onsite' | 'closed';
  serverTime: string;
}

export interface TestSessionView {
  id: string;
  label: string;
  startedAt: string;
  startedBy: string;
}

export interface TestRecordView {
  registrationId: string;
  name: string;
  phone: string;
  college: string;
  source: 'ONLINE' | 'ONSITE';
  status: string;
  submittedAt: string;
  createdBy: string | null;
  /** The session it was made in ('' when marked by hand). */
  session: string;
}

export interface TestingState {
  success: true;
  timeline: TimelineView;
  session: TestSessionView | null;
  records: TestRecordView[];
  /** Help requests sent during test sessions. */
  helpRequests: number;
  /** Events with results (winners or a submission) stored. */
  results: string[];
  /** Desk registrations that are not test data (desk IDs restart at 262001 only when none). */
  realOnsite: number;
}

export interface ClearResult {
  success: true;
  cleared: number;
  /** Still to delete: call again (each call works for a few seconds). */
  remaining: number;
  /** Where the deleted records were saved first (private, in the files bucket). */
  backup: string | null;
  results: number;
  helpRequests: number;
  deskIdsRestarted: boolean;
}

/** A deleted student, as the web assistant team's Deleted list shows them. */
export interface DeletedView {
  registrationId: string;
  name: string;
  phone: string;
  email: string;
  college: string;
  source: 'ONLINE' | 'ONSITE';
  status: string;
  deletedAt: string;
  deletedBy: string;
  reason: string;
}
