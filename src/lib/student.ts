/**
 * The student page for the event day (/landing/student/): a participant signs in with their
 * Registration ID and the phone number they registered with, downloads their pass and sees
 * their events with timing alerts. Admins switch it on or off from the dashboard, so it runs
 * only while the desks have network to spare. Shared by the page and the API; types and
 * plain data only.
 */
import type { RegistrationSource } from './admin';
import { REGISTRATION_ID, normalisePhone, normaliseRegistrationId, type RegistrationStatus } from './registration';

/** Where the main website's Student login button goes on the event day. */
export const STUDENT_PAGE = '/landing/student/';

export interface StudentCredentials {
  registrationId: string;
  phone: string;
}

/** What a sign-in needs: a Registration ID and a 10-digit phone number. Returns the problem, or null. */
export function credentialsProblem({ registrationId, phone }: StudentCredentials): string | null {
  const id = normaliseRegistrationId(registrationId);
  if (!REGISTRATION_ID.test(id)) {
    if (/^\d{1,5}$/.test(id)) return `A Registration ID has 6 digits, like 262007, but ${id} has only ${id.length}. Check for a missing digit.`;
    return 'Enter the Registration ID from your pass, e.g. 262007 (26, then 1 or 2, then your number).';
  }
  if (!/^\d{10}$/.test(normalisePhone(phone))) return 'Enter the 10-digit phone number you registered with.';
  return null;
}

/** One of the participant's events (the times and venue come from the event catalog). */
export interface StudentEvent {
  eventId: string;
  name: string;
  /** The team entered with; null on their own. */
  team: string | null;
  feePaid: boolean;
  present: boolean;
}

export interface StudentView {
  registrationId: string;
  name: string;
  college: string;
  status: RegistrationStatus;
  source: RegistrationSource;
  teamName: string | null;
  events: StudentEvent[];
  feePerEvent: number;
  /** The details typed at registration (by the desk, for a walk-in), for the student to check. */
  details: { department: string; year: string; phone: string; email: string };
  /**
   * A desk registration whose ₹100 gate pass the student pays by GPay from this page: the
   * amount, and whether their screenshot is in (then the desk checks it). Null otherwise.
   */
  payAtLogin: { amount: number; screenshotSent: boolean } | null;
  /** The pass can be downloaded (approved, and the PDF is ready). */
  passAvailable: boolean;
  /** Why the registration was rejected or cancelled, when the organisers gave a reason. */
  reason: string | null;
  /** The GPay screenshots they uploaded, and what for. */
  proofs: { kind: string; label: string; uploadedAt: string }[];
}

/** What a payment screenshot is for: the ₹100 gate pass, or one event's ₹50. */
export const proofLabel = (kind: string, eventName: (id: string) => string) => (kind === 'GATE_PASS' ? 'Gate pass ₹100' : `${eventName(kind)} ₹50`);

/** Whether the student page is on; changedBy/changedAt for the admin dashboard only. */
export interface StudentPortalState {
  enabled: boolean;
  changedBy?: string | null;
  changedAt?: string | null;
}
