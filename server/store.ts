/**
 * Where the registration workflow keeps its state: the authoritative record of every
 * registration (DynamoDB on AWS), with conditional updates so that two Lambda instances,
 * a double click or a retry can never approve twice, send two emails or hand out one
 * Registration ID twice. The Google Sheet mirrors these records for the organisers.
 */
import type { EmailStatus, PdfStatus } from '../src/lib/admin';
import type { RegistrationRecord, RegistrationStatus } from '../src/lib/registration';

export type { EmailStatus, PdfStatus, RegistrationStatus };

export interface Registration {
  /** e.g. PRG26-0042; the table's primary key. */
  registrationId: string;
  status: RegistrationStatus;
  /** ISO 8601 */
  submittedAt: string;
  /** SHA-256 of the form's submission id: the participant's private key for status and pass. */
  submissionHash: string;
  record: RegistrationRecord;
  eventIds: string[];
  /** Lower-case email and upper-case transaction ID, for duplicate checks. */
  emailKey: string;
  transactionKey: string;
  /** The payment screenshot, private in S3. */
  screenshot: { key: string; contentType: string; size: number; width: number; height: number };

  approvedAt?: string;
  rejectedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;

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

/** Values a change requires, e.g. { status: 'PENDING' } for an approval. */
export type Expectation = Partial<Pick<Registration, 'status' | 'emailStatus' | 'pdfStatus'>>;

/** What a registration claims for itself: no one else may register with the same. */
export type ClaimKind = 'submission' | 'email' | 'transaction';

export interface AdminSession {
  username: string;
  /** Fingerprint of the admin username and password hash: changing either signs everyone out. */
  credential: string;
  /** ms since epoch */
  createdAt: number;
  expiresAt: number;
}

export type CreateResult = { ok: true } | { ok: false; conflicts: ClaimKind[] };

export interface Store {
  getRegistration(registrationId: string): Promise<Registration | null>;
  /** Newest first. */
  listRegistrations(status: RegistrationStatus): Promise<Registration[]>;
  /** The registration holding a claim, if any. */
  findClaim(kind: ClaimKind, key: string): Promise<string | null>;
  /**
   * The next registration number, atomically. The very first call starts the counter at
   * `seed()` (the highest number already in the Google Sheet), so old rows are never reused.
   */
  nextRegistrationNumber(seed: () => Promise<number>): Promise<number>;
  /** Starts the counter at `seed()` if it has not started yet (done ahead by the scheduled job). */
  ensureCounter(seed: () => Promise<number>): Promise<void>;
  /** Stores a registration with its claims (submission, email, transaction), all or nothing. */
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

  putSession(tokenHash: string, session: AdminSession): Promise<void>;
  getSession(tokenHash: string): Promise<AdminSession | null>;
  deleteSession(tokenHash: string): Promise<void>;

  /** Counts one hit for `key` in the current window and returns the count so far. */
  hit(key: string, windowMs: number, now: number): Promise<number>;

  getSetting(name: string): Promise<string | null>;
  putSetting(name: string, value: string): Promise<void>;
}
