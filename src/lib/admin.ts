/**
 * What the admin dashboard (/landing/admin) and the registration API exchange. Shared by
 * both, like registration.ts; only the dashboard and the server import it, so nothing here
 * reaches the public site's bundle.
 */
import type { ParticipantDetails, RegistrationStatus } from './registration';

/** NOT_STARTED until approval; GENERATED once the PDF is stored privately. */
export type PdfStatus = 'NOT_STARTED' | 'GENERATED' | 'FAILED';

/**
 * NOT_SENT → SENDING → SENT, or FAILED (Gmail refused; safe to retry). UNKNOWN: Gmail gave
 * no clear answer, so the email may have gone out; it is resent only when an admin says so.
 */
export type EmailStatus = 'NOT_SENT' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';

/** Where a registration was made: the public website, or the desk on the event day. */
export type RegistrationSource = 'ONLINE' | 'ONSITE';

/** How staff received money at the venue. */
export type PaymentMethod = 'CASH' | 'UPI';

/**
 * The ₹100 gate pass, the registration-level payment, kept apart from the registration's
 * status and from each event's fee:
 *   online   AWAITING_VERIFICATION until an admin checks it, then VERIFIED (or REJECTED)
 *   on-site  VERIFIED when the desk records the money as received; paid by GPay from the
 *            student's own phone, AWAITING_VERIFICATION (method UPI) until staff approve it
 * and CANCELLED when an admin cancels the registration (no longer counted as collected).
 */
export interface GatePassView {
  status: 'AWAITING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'CANCELLED';
  method: 'ONLINE_UPI' | PaymentMethod;
  amount: number;
  /** UTR / UPI reference as given: a record, never proof of payment on its own. */
  reference: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

/**
 * One payment of a registration (the ₹100 gate pass, or one event's ₹50) with its evidence:
 * the screenshot the student uploaded (with the online form, or from Student login) and the
 * transaction ID they typed, next to the transaction ID the staff member entered when
 * approving it, and who approved it when.
 */
export interface PaymentRecordView {
  /** 'GATE_PASS', or the event id. */
  kind: string;
  label: string;
  amount: number;
  /** WAITING: a screenshot is in, not approved yet; UNPAID: nothing yet. */
  status: 'PAID' | 'WAITING' | 'UNPAID' | 'REJECTED' | 'CANCELLED';
  method: 'ONLINE_UPI' | PaymentMethod | null;
  screenshot: { source: 'ONLINE_FORM' | 'STUDENT_LOGIN'; proofId: string | null; uploadedAt: string } | null;
  /** Who uploaded the screenshot (always the student: their name). */
  uploadedBy: string | null;
  /** The transaction ID the student typed, with the online form or with the screenshot. */
  studentTransactionId: string | null;
  /** The transaction ID the staff member entered (desk, coordinator), if they entered one. */
  approvedTransactionId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** The registration desk where it was approved or received, if at a desk. */
  approvedAtDesk: number | null;
}

/** The ₹50 fee for one event, verified by its coordinator at the venue. */
export interface EventFeeView {
  status: 'UNPAID' | 'PAID';
  method: PaymentMethod | null;
  amount: number;
  reference: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** The last voided record, if an admin cancelled one. */
  voided: { by: string; at: string; reason: string } | null;
}

export interface AttendanceView {
  present: boolean;
  markedBy: string;
  markedAt: string;
}

/** One event on a registration: how the participant stands in it. */
export interface EventStatusView {
  eventId: string;
  name: string;
  /** Added after registration (at the desk or by the coordinator), and by whom. */
  addedBy: string | null;
  addedAt: string | null;
  /** The team entered with; null for an individual entry. */
  team: string | null;
  fee: EventFeeView;
  attendance: AttendanceView | null;
}

/** One registration as the dashboard shows it (never the participant's private key). */
export interface AdminRegistration {
  registrationId: string;
  source: RegistrationSource;
  status: RegistrationStatus;
  /** ISO 8601 */
  submittedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  /** When an admin cancelled the (approved) registration, who, and why. */
  cancelled: { at: string; by: string; reason: string } | null;
  /** The desk staff who registered an on-site participant. */
  createdBy: string | null;
  /** The registration desk (1, 2, …) they were registered at; null online or when not chosen. */
  deskNumber: number | null;
  /** The team name given at the gate, if the participant came as part of a team. */
  teamName: string | null;
  participant: ParticipantDetails;
  technicalEvents: string[];
  /** Events chosen before PRAGYA 2026 became technical-only: never charged or marked. */
  discontinuedEvents: string[];
  eventCount: number;
  feePerEvent: number;
  /** Event fees still to be paid at the venue (unpaid events × fee). */
  payableAtVenue: number;
  payment: { amount: number; transactionId: string };
  gatePass: GatePassView;
  events: EventStatusView[];
  /** GPay screenshots the student uploaded from the student page. */
  proofs: { id: string; kind: string; label: string; transactionId: string | null; uploadedAt: string }[];
  /** Every payment (gate pass, then each event) with its screenshot and transaction IDs. */
  payments: PaymentRecordView[];
  /** The online payment screenshot; null for on-site registrations. */
  screenshot: { contentType: string; size: number; width: number; height: number } | null;
  pdfStatus: PdfStatus;
  pdfGeneratedAt: string | null;
  pdfError: string | null;
  emailStatus: EmailStatus;
  emailSentAt: string | null;
  emailError: string | null;
  emailAttempts: number;
  driveLinks: { payment: string | null; pass: string | null };
  sheet: { synced: boolean; error: string | null };
  /** An approval is being finished right now (pass or email on its way). */
  processing: boolean;
}

/** A participant of one event, as its coordinator (or the certificate team) sees them. */
export interface EventParticipant {
  registrationId: string;
  source: RegistrationSource;
  status: RegistrationStatus;
  name: string;
  college: string;
  department: string;
  year: string;
  /** For coordinators and admins (to reach a participant during the event). */
  phone?: string;
  /** For the certificate team and admins. */
  email?: string;
  gatePassVerified: boolean;
  addedBy: string | null;
  addedAt: string | null;
  /** The team entered with in this event; null for an individual entry. */
  team: string | null;
  /** The team name given at the gate (a suggestion for the event's team). */
  gateTeam: string | null;
  fee: EventFeeView;
  attendance: AttendanceView | null;
  /**
   * The GPay screenshot of this event's fee the student uploaded from Student login, while the
   * fee is unpaid: for the coordinator to check and approve. Null otherwise.
   */
  feeProof: FeeProofView | null;
  /** This event's fee with its screenshot and transaction IDs, paid or not (coordinators and admins). */
  feePayment?: PaymentRecordView;
}

/** A student's GPay screenshot of an event fee, waiting for the coordinator. */
export interface FeeProofView {
  id: string;
  transactionId: string | null;
  uploadedAt: string;
}

export type Place = 'first' | 'second' | 'third';
export const PLACES: readonly Place[] = ['first', 'second', 'third'];
export const PLACE_LABELS: Record<Place, string> = { first: 'First place', second: 'Second place', third: 'Third place' };

/** Winners by place: one registration ID, or several for a team. */
export type Winners = Record<Place, string[]>;

export interface WinnerEntry {
  registrationId: string;
  name: string;
  college: string;
  team?: string | null;
}

/** What a coordinator submitted for certificates: the lists exactly as they stood. */
export interface ResultSubmissionView {
  number: number;
  submittedBy: string;
  submittedAt: string;
  participants: {
    registrationId: string;
    name: string;
    college: string;
    department: string;
    year: string;
    email: string;
    team: string | null;
    feePaid: boolean;
    present: boolean;
  }[];
  attendance: string[];
  winners: Record<Place, WinnerEntry[]>;
}

/**
 * An event's results: DRAFT while the coordinator works, SUBMITTED (finalized, locked) once
 * sent for certificates, REOPENED when an admin authorises a correction.
 */
export interface EventResultView {
  eventId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'REOPENED';
  revision: number;
  winners: Winners;
  savedBy: string | null;
  savedAt: string | null;
  submission: ResultSubmissionView | null;
  /** Earlier submissions, newest first, kept when a correction was authorised. */
  previousSubmissions: { number: number; submittedBy: string; submittedAt: string }[];
  reopened: { by: string; at: string; reason: string } | null;
}

/** An event's roster for its coordinator, an admin or the certificate team. */
export interface EventRoster {
  event: { id: string; name: string };
  result: EventResultView;
  participants: EventParticipant[];
  /** The viewer may record fees, attendance and winners here (and the day has begun). */
  canOperate: boolean;
}

/** One line per event for the results overview. */
export interface EventSummary {
  eventId: string;
  name: string;
  enrolled: number;
  feePaid: number;
  present: number;
  result: EventResultView;
}

/** Totals for the admin's reports. */
export interface ReportSummary {
  generatedAt: string;
  registrations: { total: number; online: number; onsite: number; pending: number; approved: number; rejected: number; cancelled: number };
  gatePass: {
    onlineVerified: { count: number; amount: number };
    deskCash: { count: number; amount: number };
    deskUpi: { count: number; amount: number };
  };
  /** cash and upi count the fees paid each way; cashAmount and upiAmount are the rupees. */
  events: {
    eventId: string;
    name: string;
    enrolled: number;
    feesPaid: number;
    cash: number;
    upi: number;
    cashAmount: number;
    upiAmount: number;
    amount: number;
    present: number;
    resultStatus: EventResultView['status'];
  }[];
  /** Money each staff member recorded as received (gate passes and event fees). */
  collectedBy: { username: string; cash: number; upi: number; count: number }[];
  /** Each registration desk: students registered there, and the gate passes received there. */
  desks: { desk: number; registrations: number; cashCount: number; cash: number; upiCount: number; upi: number }[];
}
