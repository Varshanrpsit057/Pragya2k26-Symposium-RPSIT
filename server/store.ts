/**
 * Where the registration workflow keeps its state: the authoritative record of every
 * registration (DynamoDB on AWS), with conditional updates so that two Lambda instances,
 * a double click or a retry can never approve twice, send two emails or hand out one
 * Registration ID twice. The Google Sheet mirrors these records for the organisers.
 */
import type { EmailStatus, PaymentMethod, PdfStatus, Place, RegistrationSource, Winners } from '../src/lib/admin';
import type { AuditEntry, HelpRequest } from '../src/lib/help';
import type { RegistrationRecord, RegistrationStatus } from '../src/lib/registration';
import type { StaffRole } from '../src/lib/staff';

export type { AuditEntry, EmailStatus, HelpRequest, PdfStatus, RegistrationStatus };

/** The ₹100 gate pass as the desk received it (on-site registrations only). */
export interface GatePassPayment {
  method: PaymentMethod;
  amount: number;
  /** UPI reference typed by the desk, if any: a record, never proof on its own. */
  reference?: string;
  /** Approved from the student's GPay screenshot (Student login): which one. */
  proofId?: string;
  receivedBy: string;
  receivedAt: string;
  /** The registration desk it was received or approved at. */
  desk?: number;
}

/** One event's ₹50 fee, as its coordinator verified it. */
export interface EventFeePayment {
  status: 'PAID' | 'VOIDED';
  method: PaymentMethod;
  amount: number;
  reference?: string;
  /** Approved from the student's GPay screenshot (Student login): which one. */
  proofId?: string;
  verifiedBy: string;
  verifiedAt: string;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
}

/** A payment screenshot a student uploaded themselves, private in S3. */
export interface PaymentProof {
  id: string;
  /** 'GATE_PASS', or the event id it pays for. */
  kind: string;
  key: string;
  contentType: string;
  size: number;
  transactionId: string | null;
  uploadedAt: string;
  /** Its copy in Google Drive (next to the payment screenshots). */
  driveFileId?: string;
}

/** How a participant stands in one event (fee and attendance kept apart). */
export interface EventParticipation {
  /** Set when the event was added after registration, at the desk or by its coordinator. */
  addedBy?: string;
  addedAt?: string;
  /** The team the participant entered this event with; missing for an individual entry. */
  team?: string;
  fee?: EventFeePayment;
  /** Voided fee records, oldest first. */
  feeHistory?: EventFeePayment[];
  attendance?: { present: boolean; markedBy: string; markedAt: string };
}

export interface Registration {
  /** e.g. 261042 (online), 262001 (on-site) or an earlier PRG26-0042; the table's primary key. */
  registrationId: string;
  /** Missing on registrations stored before the on-site desk existed: those are ONLINE. */
  source?: RegistrationSource;
  /** Made while a test session was on (or marked by an admin): deleted with the test data. */
  test?: { session: string; at: string };
  status: RegistrationStatus;
  /** ISO 8601 */
  submittedAt: string;
  /** SHA-256 of the form's submission id: the participant's private key for status and pass. */
  submissionHash: string;
  record: RegistrationRecord;
  eventIds: string[];
  /** Lower-case email and upper-case transaction ID ('' when none), for duplicate checks. */
  emailKey: string;
  transactionKey: string;
  /** On-site only: the phone number claimed for duplicate checks. */
  phoneKey?: string;
  /** The online payment screenshot, private in S3 (on-site registrations have none). */
  screenshot?: { key: string; contentType: string; size: number; width: number; height: number };
  /** On-site only: the desk staff who registered the participant, and the gate pass they took. */
  createdBy?: string;
  /** On-site only: the registration desk (1, 2, …) they were registered at. */
  deskNumber?: number;
  /** The team name given at the gate, for a participant who comes as part of a team. */
  teamName?: string;
  gatePass?: GatePassPayment;
  /** Event fee and attendance, by event id. */
  participation?: Record<string, EventParticipation>;
  /** GPay screenshots the student uploaded from the student page (desk gate pass, event fees). */
  proofs?: PaymentProof[];

  approvedAt?: string;
  rejectedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  /** An approved registration an admin cancelled: when, by whom and why. */
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;

  pdfStatus: PdfStatus;
  pdfKey?: string;
  pdfGeneratedAt?: string;
  pdfError?: string;

  emailStatus: EmailStatus;
  emailAttempts: number;
  emailSentAt?: string;
  emailMessageId?: string;
  emailError?: string;

  /** Copies in Google Drive. */
  paymentDriveFileId?: string;
  paymentDriveFileName?: string;
  passDriveFileId?: string;
  passDriveFileName?: string;

  /** The student's record file (JSON) in Google Drive, and which version of this record it shows. */
  recordFileId?: string;
  recordVersion?: number;
  recordError?: string;
  recordAttempts?: number;

  /** Google Sheet mirror: the row exists, and which version of this record it shows. */
  sheetRow: boolean;
  version: number;
  sheetVersion: number;
  syncError?: string;
  syncAttempts: number;

  /** Held while one request finishes an approval (PDF, email), so no other can at the same time. */
  leaseUntil?: number;
  leaseId?: string;
}

/** Fields to change; null removes a field. */
export type RegistrationChanges = { [K in keyof Registration]?: Registration[K] | null };

/**
 * Values a change requires, e.g. { status: 'PENDING' } for an approval, or { version } for
 * a change worked out from the record as it was read (optimistic concurrency).
 */
export type Expectation = Partial<Pick<Registration, 'status' | 'emailStatus' | 'pdfStatus' | 'version'>>;

/** What a registration claims for itself: no one else may register with the same. */
export type ClaimKind = 'submission' | 'email' | 'transaction' | 'phone';

/** The claims a registration holds (transaction and phone only when it has them). */
export function claimsOf(registration: Registration): [ClaimKind, string][] {
  const claims: [ClaimKind, string][] = [
    ['submission', registration.submissionHash],
    ['email', registration.emailKey],
  ];
  if (registration.transactionKey) claims.push(['transaction', registration.transactionKey]);
  if (registration.phoneKey) claims.push(['phone', registration.phoneKey]);
  return claims;
}

/** The registration number counters: online 261NNN and on-site 262NNN. */
export type CounterName = 'registration' | 'onsite';

export interface AdminSession {
  username: string;
  /** 'staff': an account in the Control table; missing or 'owner': the ADMIN_USERNAME secret. */
  kind?: 'owner' | 'staff';
  /** Fingerprint of the username and password hash: changing the password signs the account out. */
  credential: string;
  /** ms since epoch */
  createdAt: number;
  expiresAt: number;
  /** The registration desk this sign-in is at (desk accounts). */
  deskNumber?: number;
}

/** A staff account (Control table, pk staff#<username>). */
export interface StaffAccount {
  username: string;
  displayName: string;
  role: StaffRole;
  eventIds: string[];
  /** The department (department roles) and the desk (desk accounts). */
  department?: string;
  deskNumber?: number;
  /** scrypt, as made by hashPassword; never leaves the server. */
  passwordHash: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  passwordChangedAt: string;
  /** Bumped on every change, for safe concurrent edits. */
  revision: number;
  /** An admin signed them out then: sessions made before it end. */
  signedOutAt?: string;
  /** When they last signed in (kept apart from the revision: signing in never clashes with an edit). */
  lastSignInAt?: string;
}

export interface ResultSubmission {
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
  winners: Record<Place, { registrationId: string; name: string; college: string; team?: string | null }[]>;
}

/** An event's winners and submissions (Control table, pk result#<eventId>). */
export interface EventResult {
  eventId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'REOPENED';
  /** 0 until first stored; bumped on every change, for safe concurrent edits. */
  revision: number;
  winners: Winners;
  savedBy?: string;
  savedAt?: string;
  submission?: ResultSubmission;
  /** Earlier submissions, newest first (a few are kept). */
  previousSubmissions?: ResultSubmission[];
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
}

export type CreateResult = { ok: true } | { ok: false; conflicts: ClaimKind[] };

export interface Store {
  getRegistration(registrationId: string): Promise<Registration | null>;
  /** Newest first. */
  listRegistrations(status: RegistrationStatus): Promise<Registration[]>;
  /** The registration holding a claim, if any. */
  findClaim(kind: ClaimKind, key: string): Promise<string | null>;
  /**
   * The next number of a counter, atomically. The very first call starts the counter at
   * `seed()` (for online IDs: the highest number already in the Google Sheet), so old
   * numbers are never reused.
   */
  nextRegistrationNumber(seed: () => Promise<number>, counter?: CounterName): Promise<number>;
  /** Starts the counter at `seed()` if it has not started yet (done ahead by the scheduled job). */
  ensureCounter(seed: () => Promise<number>, counter?: CounterName): Promise<void>;
  /** Sets a counter (the next number is `value + 1`): after test data is deleted, desk IDs start again. */
  setCounter(counter: CounterName, value: number): Promise<void>;
  /**
   * Stores a registration with its claims (claimsOf), all or nothing. Fails with no conflicts
   * listed when the Registration ID itself is already taken.
   */
  createRegistration(registration: Registration): Promise<CreateResult>;
  /**
   * Changes a registration if it still matches `expect`; returns the updated record, or
   * null when it does not match (or does not exist). `bump` (default true) marks the
   * change for the Google Sheet mirror.
   */
  updateRegistration(
    registrationId: string,
    changes: RegistrationChanges,
    options?: { expect?: Expectation; bump?: boolean },
  ): Promise<Registration | null>;
  /** Takes the registration's processing lease until `until`; null while someone else holds it. */
  acquireLease(registrationId: string, until: number, now: number): Promise<string | null>;
  releaseLease(registrationId: string, leaseId: string): Promise<void>;
  /** Frees a claim (e.g. the email of a rejected registration), only if this registration holds it. */
  releaseClaim(kind: ClaimKind, key: string, registrationId: string): Promise<void>;
  /** Takes a claim for this registration unless another holds it; true when it is this registration's. */
  claim(kind: ClaimKind, key: string, registrationId: string): Promise<boolean>;
  /** Deletes a registration if it is still at `version` (its claims are released separately). */
  deleteRegistration(registrationId: string, version: number): Promise<boolean>;

  putSession(tokenHash: string, session: AdminSession): Promise<void>;
  getSession(tokenHash: string): Promise<AdminSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Every session still stored (expired ones may linger until removed). */
  listSessions(): Promise<AdminSession[]>;

  getStaff(username: string): Promise<StaffAccount | null>;
  listStaff(): Promise<StaffAccount[]>;
  /** Stores the account if its stored revision is still `expectedRevision` (0: must not exist yet). */
  saveStaff(account: StaffAccount, expectedRevision: number): Promise<boolean>;
  /** Removes the account if its stored revision is still `expectedRevision`. */
  deleteStaff(username: string, expectedRevision: number): Promise<boolean>;
  /** Records a sign-in on the account (no revision change); nothing when the account is gone. */
  noteStaffSignIn(username: string, at: string): Promise<void>;

  getEventResult(eventId: string): Promise<EventResult | null>;
  /** Stores the result if its stored revision is still `expectedRevision` (0: must not exist yet). */
  saveEventResult(result: EventResult, expectedRevision: number): Promise<boolean>;
  /** Removes an event's results (test data only). */
  deleteEventResult(eventId: string): Promise<void>;

  /** Counts one hit for `key` in the current window and returns the count so far. */
  hit(key: string, windowMs: number, now: number): Promise<number>;

  getSetting(name: string): Promise<string | null>;
  putSetting(name: string, value: string): Promise<void>;

  /** Help requests sent with Contact admin (Control table, pk help#<id>). */
  getHelpRequest(id: string): Promise<HelpRequest | null>;
  listHelpRequests(): Promise<HelpRequest[]>;
  saveHelpRequest(request: HelpRequest): Promise<void>;
  /** Removes a help request (test data only). */
  deleteHelpRequest(id: string): Promise<void>;

  /** Deleted, restored and test-cleared records (Control table, pk audit#<time>#<id>). */
  addAuditEntry(entry: AuditEntry): Promise<void>;
  listAuditEntries(): Promise<AuditEntry[]>;
}
