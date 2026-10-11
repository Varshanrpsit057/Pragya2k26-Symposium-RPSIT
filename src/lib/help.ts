/**
 * Contact admin: a student coordinator (signed in or not) reports a problem from the dashboard
 * or its sign-in page; admins and the web assistant team see and answer it. Also the system
 * status the web assistant team watches. Shared by the dashboard and the API; types and plain
 * data only.
 */

export const HELP_CATEGORIES = {
  SITE_DOWN: 'The website or a page is not loading',
  SIGN_IN: 'I cannot sign in',
  WRONG_DETAILS: "A student's details are wrong",
  PAYMENT: 'A payment problem',
  OTHER: 'Something else',
} as const;

export type HelpCategory = keyof typeof HELP_CATEGORIES;

export const isHelpCategory = (value: unknown): value is HelpCategory => typeof value === 'string' && value in HELP_CATEGORIES;

export interface HelpRequest {
  id: string;
  createdAt: string;
  category: HelpCategory;
  message: string;
  /** Who sent it: the signed-in account, or the name and phone typed on the sign-in page. */
  name: string;
  contact: string | null;
  username: string | null;
  /** The student it is about, if any. */
  registrationId: string | null;
  /** Where it happened (the dashboard section), for the web assistant team. */
  page: string | null;
  status: 'OPEN' | 'RESOLVED';
  /** Sent during a test session: deleted with the test data. */
  test?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  /** Answers from the web assistant team or an admin, oldest first: the sender sees them. */
  replies?: HelpReply[];
}

export interface HelpReply {
  by: string;
  at: string;
  text: string;
}

/** A record an admin deleted: kept so there is always a name against the deletion. */
export interface AuditEntry {
  at: string;
  /** DELETED: a record deleted (kept here whole); RESTORED: brought back; TEST_CLEARED: test data deleted. */
  action: 'DELETED' | 'RESTORED' | 'TEST_CLEARED';
  registrationId: string;
  name: string;
  by: string;
  reason: string;
  /** The whole record as it was (JSON), so nothing is lost; kept on the server only. */
  snapshot?: string;
}

/** One registration that needs attention, and why. */
export interface SystemProblem {
  registrationId: string;
  name: string;
  problems: string[];
}

export interface SystemStatus {
  serverTime: string;
  phase: 'online' | 'between' | 'onsite' | 'closed';
  studentPortal: boolean;
  registrations: { total: number; online: number; onsite: number; pending: number; approved: number; rejected: number; cancelled: number };
  counts: { passFailed: number; emailFailed: number; emailUnconfirmed: number; sheetWaiting: number; sheetFailed: number; paymentWaiting: number };
  problems: SystemProblem[];
  openHelp: number;
  deleted: AuditEntry[];
}
