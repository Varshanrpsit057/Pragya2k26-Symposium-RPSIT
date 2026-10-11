/**
 * The admin dashboard's calls to the registration API. Sign-in returns a session token,
 * kept in sessionStorage (gone when the tab closes) and sent as a Bearer token; the server
 * checks it, and the account's role, on every request, so nothing here decides who may do what.
 */
import type {
  AdminRegistration,
  EventParticipant,
  EventResultView,
  EventRoster,
  EventSummary,
  PaymentMethod,
  ReportSummary,
  Winners,
} from '../lib/admin';
import { API_BASE, apiUrl } from '../lib/api';
import type { HelpCategory, HelpRequest, SystemStatus } from '../lib/help';
import type { RegistrationErrors } from '../lib/registration';
import type { StudentPortalState } from '../lib/student';
import type { SessionInfo, SignedInView, StaffAccountView, StaffRole } from '../lib/staff';
import {
  CLEAR_PHRASE,
  type ClearResult,
  type DeletedView,
  type RegistrationWindowView,
  type SiteNoticeView,
  type TestSessionView,
  type TestingState,
  type TimelineMode,
  type TimelineView,
  type WindowAction,
} from '../lib/testTools';

const TOKEN_KEY = 'pragya-admin-session';

/** The session has ended (expired, signed out, or the password changed): sign in again. */
export class SignedOut extends Error {}

/** The server refused: its message, plus a code and details (e.g. the registration that already holds an email). */
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly details: Record<string, string> = {},
    readonly fieldErrors: RegistrationErrors = {},
  ) {
    super(message);
  }
}

export function savedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the session lasts until the page is reloaded.
  }
}

type Failure = { success: false; error?: string; code?: string; details?: Record<string, string>; fieldErrors?: RegistrationErrors };

async function request<T>(path: `/api/${string}`, { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(API_BASE, path), {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as ({ success: true } & T) | Failure | null;
  if (response.status === 401 && token) {
    saveToken(null);
    throw new SignedOut((data as Failure | null)?.error ?? 'Please sign in again.');
  }
  if (!response.ok || !data?.success) {
    const failure = data as Failure | null;
    // The gateway's own throttle answers without our JSON.
    if (response.status === 429 && !failure?.error) throw new ApiFailure('The server is busy. Please wait a moment and try again.', 429, 'BUSY');
    throw new ApiFailure(failure?.error ?? `The server answered ${response.status}.`, response.status, failure?.code ?? null, failure?.details, failure?.fieldErrors);
  }
  return data;
}

/** Signs in; a registration desk account also says which desk it is at. */
export async function signIn(username: string, password: string, deskNumber: number | null = null): Promise<string> {
  const { token } = await request<{ token: string }>('/api/admin/login', { method: 'POST', body: { username, password, ...(deskNumber && { deskNumber }) } });
  saveToken(token);
  return token;
}

export async function signOut(token: string) {
  saveToken(null);
  await request('/api/admin/logout', { method: 'POST', body: {}, token }).catch(() => undefined);
}

export const currentAdmin = (token: string) => request<SessionInfo>('/api/admin/session', { token });
/** A desk account says which registration desk it is at (or moves to another). */
export const setDeskNumber = (token: string, deskNumber: number) => request<SessionInfo>('/api/admin/session/desk', { method: 'POST', body: { deskNumber }, token });
/** Admins: who is signed in right now, with their desk. */
export const signedInNow = (token: string) => request<{ sessions: SignedInView[] }>('/api/admin/sessions', { token }).then((data) => data.sessions);

// --- Registrations ------------------------------------------------------------------------

export const listRegistrations = (token: string) =>
  request<{ registrations: AdminRegistration[] }>('/api/admin/registrations', { token }).then((data) => data.registrations);

export const getRegistration = (token: string, id: string) =>
  request<{ registration: AdminRegistration }>(`/api/admin/registrations/${encodeURIComponent(id)}`, { token }).then((data) => data.registration);

const action = (token: string, id: string, name: 'approve' | 'reject' | 'retry' | 'events' | 'cancel' | 'details', body: unknown = {}) =>
  request<{ registration: AdminRegistration }>(`/api/admin/registrations/${encodeURIComponent(id)}/${name}`, {
    method: 'POST',
    body,
    token,
  }).then((data) => data.registration);

/**
 * The ₹100 of a desk student who paid by GPay from Student login, as the approver recorded it:
 * the transaction ID from their screenshot, or cash when they paid cash in the end.
 */
export type DeskGatePass = { method: 'UPI'; reference: string } | { method: 'CASH' };

export const approve = (token: string, id: string, payment?: DeskGatePass) => action(token, id, 'approve', payment ? { payment } : {});
export const reject = (token: string, id: string, reason: string) => action(token, id, 'reject', { reason });
export const retry = (token: string, id: string, resendEmail = false) => action(token, id, 'retry', { resendEmail });
/** Admins: cancel an approved registration, with the reason the student sees. */
export const cancelRegistration = (token: string, id: string, reason: string) => action(token, id, 'cancel', { reason });
/** Admins: delete a record for good, with the reason (kept in the audit log). */
/** The Deleted list (web assistant team and admins), and bringing a record back. */
export const listDeleted = (token: string) => request<{ deleted: DeletedView[] }>('/api/admin/deleted', { token }).then((data) => data.deleted);
export const restoreDeleted = (token: string, id: string) =>
  request<{ registration: AdminRegistration }>(`/api/admin/deleted/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {}, token }).then((data) => data.registration);

/** Test sessions (admins). */
export const testingState = (token: string) => request<TestingState>('/api/admin/testing', { token });
export interface TimelineRequest {
  mode: TimelineMode;
  hours?: number;
  schedule?: { onlineClosesAt: string; onsiteOpensAt: string; onsiteClosesAt: string };
}
export const setTimeline = (token: string, change: TimelineRequest) =>
  request<{ timeline: TimelineView }>('/api/admin/testing/timeline', { method: 'POST', body: change, token }).then((data) => data.timeline);
export const startTestSession = (token: string, label: string) =>
  request<{ session: TestSessionView }>('/api/admin/testing/session', { method: 'POST', body: { action: 'start', label }, token }).then((data) => data.session);
export const stopTestSession = (token: string) => request<object>('/api/admin/testing/session', { method: 'POST', body: { action: 'stop' }, token });
export const markTest = (token: string, id: string, test: boolean) =>
  request<object>(`/api/admin/testing/records/${encodeURIComponent(id)}`, { method: 'POST', body: { test }, token });
export const clearTestData = (token: string, options: { results: boolean; helpRequests: boolean; restartDeskIds: boolean }) =>
  request<ClearResult>('/api/admin/testing/clear', { method: 'POST', body: { confirm: CLEAR_PHRASE, ...options }, token });

export const deleteRegistration = (token: string, id: string, reason: string) =>
  request<{ deleted: string }>(`/api/admin/registrations/${encodeURIComponent(id)}/delete`, { method: 'POST', body: { reason }, token }).then((data) => data.deleted);

export interface DetailsChange {
  name: string;
  department: string;
  college: string;
  year: string;
  phone: string;
  email: string;
  /** Send the pass email again (e.g. to a corrected address). */
  resendEmail?: boolean;
}

/** Correct a student's details (desk, web assistant team, admins). */
export const editDetails = (token: string, id: string, change: DetailsChange) => action(token, id, 'details', change);
export const changeEvents = (token: string, id: string, change: { add?: string[]; remove?: string[] }) => action(token, id, 'events', change);

/** Short-lived links (a few minutes) to a screenshot: a small copy to show, and the original. */
export interface ScreenshotLinks {
  url: string;
  originalUrl?: string;
}
const linksOf = (data: ScreenshotLinks): ScreenshotLinks => ({ url: data.url, ...(data.originalUrl && data.originalUrl !== data.url && { originalUrl: data.originalUrl }) });

/** Short-lived links (a few minutes) to the payment screenshot and the pass. */
export const screenshotUrl = (token: string, id: string) =>
  request<ScreenshotLinks>(`/api/admin/registrations/${encodeURIComponent(id)}/screenshot`, { token }).then(linksOf);
export const passUrl = (token: string, id: string) =>
  request<{ url: string }>(`/api/admin/registrations/${encodeURIComponent(id)}/pass`, { token }).then((data) => data.url);

export interface ReceivedPayment {
  method: PaymentMethod;
  reference?: string;
  /** The staff member confirms the money was received (in hand, or seen credited). */
  confirmedReceived: boolean;
}

export interface OnsiteForm {
  submissionId: string;
  participant: { name: string; department: string; college: string; year: string; phone: string; email: string };
  participation: 'INDIVIDUAL' | 'TEAM';
  teamName?: string;
  /** Event ids chosen at the desk (may be none); each event's ₹50 is paid at its venue. */
  events: string[];
  /** Received at the desk, or GPay the student pays from Student login (approved later). */
  payment: ReceivedPayment | { method: 'UPI'; studentPays: true };
}

/** Admins: whether the event-day student page is on, and switching it. */
export const studentPortal = (token: string) => request<StudentPortalState>('/api/admin/student-portal', { token });
export const setStudentPortal = (token: string, enabled: boolean) =>
  request<StudentPortalState>('/api/admin/student-portal', { method: 'POST', body: { enabled }, token });

export const registerOnsite = (token: string, form: OnsiteForm) =>
  request<{ registration: AdminRegistration; replayed: boolean }>('/api/admin/onsite', { method: 'POST', body: form, token });

// --- Events, results ------------------------------------------------------------------------

export const listEvents = (token: string) => request<{ events: EventSummary[] }>('/api/admin/events', { token }).then((data) => data.events);

export const eventRoster = (token: string, eventId: string) => request<EventRoster>(`/api/admin/events/${encodeURIComponent(eventId)}`, { token });

export interface ParticipantLookup {
  registrationId: string;
  source: 'ONLINE' | 'ONSITE';
  status: AdminRegistration['status'];
  name: string;
  college: string;
  department: string;
  year: string;
  gatePassVerified: boolean;
  teamName: string | null;
  /** The ₹100 gate pass: for checking a GPay payment made online against its screenshot. */
  payment: { amount: number; transactionId: string | null; hasScreenshot: boolean; proofId: string | null };
  events: {
    eventId: string;
    name: string;
    enrolled: boolean;
    team: string | null;
    fee: EventParticipant['fee'];
    attendance: EventParticipant['attendance'];
    feeProof: EventParticipant['feeProof'];
  }[];
}

// --- Contact admin and the system status -------------------------------------------------------

export interface HelpForm {
  category: HelpCategory;
  message: string;
  name?: string;
  contact?: string;
  registrationId?: string;
  page?: string;
}

/** Sends a help request; works signed out too (the problem may be signing in). */
export const sendHelp = (form: HelpForm, token: string | null) => request<{ id: string }>('/api/help', { method: 'POST', body: form, token }).then((data) => data.id);
export const listHelp = (token: string) => request<{ requests: HelpRequest[] }>('/api/admin/help', { token }).then((data) => data.requests);
/** Answers a help request (the sender sees it) and/or marks it resolved or open again. */
export const updateHelp = (token: string, id: string, change: { status?: HelpRequest['status']; reply?: string }) =>
  request<{ request: HelpRequest }>(`/api/admin/help/${encodeURIComponent(id)}`, { method: 'POST', body: change, token }).then((data) => data.request);
/** The help requests this student coordinator sent, with the answers. */
export const myHelp = (token: string) => request<{ requests: HelpRequest[] }>('/api/help/mine', { token }).then((data) => data.requests);
/** Five-minute links to a GPay screenshot the student uploaded (a small copy and the original). */
export const proofUrl = (token: string, id: string, proofId: string) =>
  request<ScreenshotLinks>(`/api/admin/registrations/${encodeURIComponent(id)}/proofs/${encodeURIComponent(proofId)}`, { token }).then(linksOf);
export const systemStatus = (token: string) => request<SystemStatus>('/api/admin/system', { token });

export const lookupParticipant = (token: string, id: string) => request<ParticipantLookup>(`/api/admin/lookup/${encodeURIComponent(id)}`, { token });

const participantAction = (token: string, eventId: string, id: string, name: 'enroll' | 'fee' | 'fee-screenshot' | 'attendance' | 'void-fee', body: unknown = {}) =>
  request<{ participant: EventParticipant }>(`/api/admin/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(id)}/${name}`, {
    method: 'POST',
    body,
    token,
  }).then((data) => data.participant);

/**
 * Enters a participant in the event at the venue: individual (team null) or with a team, and
 * with the ₹50 fee in the same step when `payment` is given.
 */
export const enroll = (token: string, eventId: string, id: string, entry: { team?: string | null; payment?: ReceivedPayment } = {}) =>
  participantAction(token, eventId, id, 'enroll', entry);
export const recordFee = (token: string, eventId: string, id: string, payment: ReceivedPayment) => participantAction(token, eventId, id, 'fee', payment);
export const markAttendance = (token: string, eventId: string, id: string, present: boolean) => participantAction(token, eventId, id, 'attendance', { present });
export const voidFee = (token: string, eventId: string, id: string, reason: string) => participantAction(token, eventId, id, 'void-fee', { reason });
/** A ₹50 fee paid by GPay from Student login, approved from the student's screenshot (and marked present, if asked). */
export const approveFeeScreenshot = (token: string, eventId: string, id: string, change: { proofId: string; reference: string; markPresent: boolean }) =>
  participantAction(token, eventId, id, 'fee-screenshot', change);

const resultAction = (token: string, eventId: string, name: 'winners' | 'submit' | 'reopen', body: unknown = {}) =>
  request<{ result: EventResultView }>(`/api/admin/events/${encodeURIComponent(eventId)}/${name}`, { method: 'POST', body, token }).then((data) => data.result);

export const saveWinners = (token: string, eventId: string, winners: Winners) => resultAction(token, eventId, 'winners', winners);
export const submitResults = (token: string, eventId: string) => resultAction(token, eventId, 'submit');
export const reopenResults = (token: string, eventId: string, reason: string) => resultAction(token, eventId, 'reopen', { reason });

// --- Staff, reports --------------------------------------------------------------------------

export const listStaff = (token: string) => request<{ staff: StaffAccountView[] }>('/api/admin/staff', { token }).then((data) => data.staff);

export interface StaffChange {
  username?: string;
  displayName?: string;
  role?: StaffRole;
  eventIds?: string[];
  active?: boolean;
  password?: string;
}

export const createStaff = (token: string, account: StaffChange) =>
  request<{ account: StaffAccountView }>('/api/admin/staff', { method: 'POST', body: account, token }).then((data) => data.account);

export const updateStaff = (token: string, username: string, change: StaffChange) =>
  request<{ account: StaffAccountView }>(`/api/admin/staff/${encodeURIComponent(username)}`, { method: 'POST', body: change, token }).then((data) => data.account);
/** Deletes a staff account (e.g. one made for testing); anyone signed in with it is signed out. */
export const deleteStaff = (token: string, username: string) =>
  request<{ deleted: string }>(`/api/admin/staff/${encodeURIComponent(username)}/delete`, { method: 'POST', body: {}, token }).then((data) => data.deleted);

/** Signs the person out on every device now; they can sign in again. */
export const signOutStaff = (token: string, username: string) =>
  request<{ signedOut: string }>(`/api/admin/staff/${encodeURIComponent(username)}/sign-out`, { method: 'POST', body: {}, token }).then((data) => data.signedOut);

// --- Event-day controls (admins): the notice on the website, the registration times ----------

export const siteNotice = (token: string) => request<SiteNoticeView>('/api/admin/site-notice', { token }).then((data) => data.notice);
/** Posts the notice (or, with '', takes it down). */
export const setSiteNotice = (token: string, text: string) =>
  request<SiteNoticeView>('/api/admin/site-notice', { method: 'POST', body: { text }, token }).then((data) => data.notice);

export const registrationWindow = (token: string) => request<RegistrationWindowView>('/api/admin/registration-window', { token });
export interface WindowRequest {
  action: WindowAction;
  /** 'onsite-until': '2026-10-17T14:00' (IST). */
  onsiteClosesAt?: string;
  /** 'custom': the three times (IST). */
  schedule?: { onlineClosesAt: string; onsiteOpensAt: string; onsiteClosesAt: string };
}
export const setRegistrationWindow = (token: string, change: WindowRequest) =>
  request<RegistrationWindowView>('/api/admin/registration-window', { method: 'POST', body: change, token });

export const getReport = (token: string) => request<{ report: ReportSummary }>('/api/admin/reports', { token }).then((data) => data.report);
