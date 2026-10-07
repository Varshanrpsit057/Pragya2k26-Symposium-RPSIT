/**
 * What the admin dashboard (/landing/admin) and the registration API exchange. Shared by
 * both, like registration.ts; types only, so nothing here reaches the public site's bundle.
 */
import type { ParticipantDetails, RegistrationStatus } from './registration';

/** NOT_STARTED until approval; GENERATED once the PDF is stored privately. */
export type PdfStatus = 'NOT_STARTED' | 'GENERATED' | 'FAILED';

/**
 * NOT_SENT → SENDING → SENT, or FAILED (Gmail refused; safe to retry). UNKNOWN: Gmail gave
 * no clear answer, so the email may have gone out; it is resent only when an admin says so.
 */
export type EmailStatus = 'NOT_SENT' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN';

/** One registration as the dashboard shows it (never the participant's private key). */
export interface AdminRegistration {
  registrationId: string;
  status: RegistrationStatus;
  /** ISO 8601 */
  submittedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  participant: ParticipantDetails;
  technicalEvents: string[];
  nonTechnicalEvents: string[];
  eventCount: number;
  feePerEvent: number;
  payableAtVenue: number;
  payment: { amount: number; transactionId: string };
  screenshot: { contentType: string; size: number; width: number; height: number };
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
