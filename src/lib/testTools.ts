/**
 * Test sessions, as the dashboard sees them (Testing, admins only): the timeline the website
 * follows, the session that marks what is made while testing, and the records it marked.
 * Types and plain data only: shared by the API and the dashboard.
 */
import type { RegistrationSchedule } from './schedule';

/** What an admin types to delete test data, so it is never done by a stray click. */
export const CLEAR_PHRASE = 'DELETE TEST DATA';
/** Typed to delete every fest registration, test or not (Start fresh, e.g. after a rehearsal day). */
export const START_FRESH_PHRASE = 'DELETE EVERYTHING';

/** The quick timelines, plus a custom one and the real schedule. */
export type TimelineMode = 'standard' | 'onsite-now' | 'online-now' | 'closed' | 'custom';

export interface TimelineView {
  /** What the website and the API follow now. */
  schedule: RegistrationSchedule;
  /** The real schedule: the planned one (src/content/site.ts), or as an admin changed it (Registration times). */
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

/**
 * The registration times an admin controls (Registration times in the dashboard): the planned
 * schedule, and any change made to it, e.g. on-site registration reopened until 2 PM.
 */
export interface RegistrationWindowView {
  success: true;
  /** As planned (src/content/site.ts). */
  planned: RegistrationSchedule;
  /** The real schedule: the planned one, or the admin's change. */
  real: RegistrationSchedule;
  /** What the website and the API follow now (a test timeline may replace the real one). */
  inForce: RegistrationSchedule;
  changed: { setBy: string; setAt: string } | null;
  /** A test timeline (Testing) is on and replaces the real schedule until it is set back. */
  testTimeline: boolean;
  phase: 'online' | 'between' | 'onsite' | 'closed';
  serverTime: string;
}

/**
 * - 'onsite-until': on-site registration open until the time given (it opens now if it was not open yet)
 * - 'close-now': every registration closes now
 * - 'custom': the three times given
 * - 'planned': back to the planned schedule
 */
export type WindowAction = 'onsite-until' | 'close-now' | 'custom' | 'planned';

/** A notice an admin posts on the website and the student page (e.g. "COGNIX has moved to LH-05"). */
export interface SiteNotice {
  text: string;
  setAt: string;
}

export const NOTICE_MAX = 300;

export interface SiteNoticeView {
  success: true;
  notice: (SiteNotice & { setBy: string }) | null;
}
