/**
 * Reading a registration's three separate money and status facts, without side effects:
 *
 *   registration status   PENDING / APPROVED / REJECTED (the registration itself)
 *   gate pass             the ₹100 registration-level payment (online UPI, or cash/UPI at the desk)
 *   event fee             ₹50 per event, verified by that event's coordinator at the venue
 *
 * plus attendance per event. Shared by the dashboard views, the coordinators' checks, the
 * Google Sheet row and the reports.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import type { AttendanceView, EventFeeView, EventStatusView, GatePassView, PaymentRecordView } from '../src/lib/admin';
import type { Fees, RegistrationRecord } from '../src/lib/registration';
import { proofLabel } from '../src/lib/student';
import type { EventParticipation, PaymentProof, Registration } from './store';

/** The registration's events that exist now (technical only), in the site's order. */
export const currentEventIds = (registration: Pick<Registration, 'eventIds'>) =>
  eventCatalog.filter((event) => registration.eventIds.includes(event.id)).map((event) => event.id);

export const eventName = (eventId: string) => eventCatalog.find((event) => event.id === eventId)?.name ?? eventId;

export const participationOf = (registration: Registration, eventId: string): EventParticipation =>
  registration.participation?.[eventId] ?? {};

export const isFeePaid = (registration: Registration, eventId: string) => participationOf(registration, eventId).fee?.status === 'PAID';

export const isPresent = (registration: Registration, eventId: string) => participationOf(registration, eventId).attendance?.present === true;

export const sourceOf = (registration: Pick<Registration, 'source'>) => registration.source ?? 'ONLINE';

/** Only online registrations have a participant pass; at the desk the Registration ID is enough. */
export const hasPass = (registration: Pick<Registration, 'source'>) => sourceOf(registration) !== 'ONSITE';

export function gatePassView(registration: Registration): GatePassView {
  const { gatePass } = registration;
  const cancelled = registration.status === 'CANCELLED';
  if (gatePass) {
    return {
      status: cancelled ? 'CANCELLED' : 'VERIFIED',
      method: gatePass.method,
      amount: gatePass.amount,
      reference: gatePass.reference ?? null,
      verifiedBy: gatePass.receivedBy,
      verifiedAt: gatePass.receivedAt,
    };
  }
  const status = cancelled ? 'CANCELLED' : registration.status === 'APPROVED' ? 'VERIFIED' : registration.status === 'REJECTED' ? 'REJECTED' : 'AWAITING_VERIFICATION';
  return {
    status,
    // A desk registration without its gate pass yet: the student pays by GPay from Student login.
    method: sourceOf(registration) === 'ONSITE' ? 'UPI' : 'ONLINE_UPI',
    amount: registration.record.payment.gatePassAmount,
    reference: registration.record.payment.transactionId || null,
    verifiedBy: status === 'AWAITING_VERIFICATION' ? null : (registration.reviewedBy ?? null),
    verifiedAt: registration.approvedAt ?? registration.rejectedAt ?? null,
  };
}

export function feeView(registration: Registration, eventId: string, fees: Fees): EventFeeView {
  const { fee, feeHistory } = participationOf(registration, eventId);
  const lastVoid = [...(feeHistory ?? [])].reverse().find((entry) => entry.status === 'VOIDED');
  const voided = lastVoid ? { by: lastVoid.voidedBy ?? '', at: lastVoid.voidedAt ?? '', reason: lastVoid.voidReason ?? '' } : null;
  if (fee?.status === 'PAID') {
    return {
      status: 'PAID',
      method: fee.method,
      amount: fee.amount,
      reference: fee.reference ?? null,
      verifiedBy: fee.verifiedBy,
      verifiedAt: fee.verifiedAt,
      voided,
    };
  }
  return { status: 'UNPAID', method: null, amount: fees.perEvent, reference: null, verifiedBy: null, verifiedAt: null, voided };
}

export function attendanceView(registration: Registration, eventId: string): AttendanceView | null {
  const attendance = participationOf(registration, eventId).attendance;
  return attendance ? { present: attendance.present, markedBy: attendance.markedBy, markedAt: attendance.markedAt } : null;
}

export function eventStatusViews(registration: Registration, fees: Fees): EventStatusView[] {
  return currentEventIds(registration).map((eventId) => {
    const participation = participationOf(registration, eventId);
    return {
      eventId,
      name: eventName(eventId),
      addedBy: participation.addedBy ?? null,
      addedAt: participation.addedAt ?? null,
      team: participation.team ?? null,
      fee: feeView(registration, eventId, fees),
      attendance: attendanceView(registration, eventId),
    };
  });
}

/** The record's event names and counts for a new list of events (fees worked out again). */
export function recordWithEvents(record: RegistrationRecord, eventIds: readonly string[], fees: Fees): RegistrationRecord {
  const chosen = eventCatalog.filter((event) => eventIds.includes(event.id));
  return {
    ...record,
    technicalEvents: chosen.map((event) => event.name),
    eventRegistration: { eventCount: chosen.length, feePerEvent: fees.perEvent, totalEventFee: chosen.length * fees.perEvent },
  };
}

/** Event fees still owed at the venue: unpaid current events × the fee. */
export const unpaidEventFees = (registration: Registration, fees: Fees) =>
  currentEventIds(registration).filter((eventId) => !isFeePaid(registration, eventId)).length * fees.perEvent;

// ---------------------------------------------------------------------------------------
// Payments with their evidence: what the student uploaded and typed, what the staff entered.

const proofById = (registration: Registration, id: string | undefined) => (id ? ((registration.proofs ?? []).find((proof) => proof.id === id) ?? null) : null);
const latestProof = (registration: Registration, kind: string) => [...(registration.proofs ?? [])].reverse().find((proof) => proof.kind === kind) ?? null;
const fromProof = (proof: PaymentProof | null) => (proof ? { source: 'STUDENT_LOGIN' as const, proofId: proof.id, uploadedAt: proof.uploadedAt } : null);

/** One event's ₹50: approved (from which screenshot, with which transaction ID, by whom), waiting with a screenshot, or unpaid. */
export function eventPaymentRecord(registration: Registration, eventId: string, fees: Fees): PaymentRecordView {
  const student = registration.record.participant.name;
  const label = proofLabel(eventId, eventName);
  const fee = participationOf(registration, eventId).fee;
  if (fee?.status === 'PAID') {
    const proof = proofById(registration, fee.proofId);
    return {
      kind: eventId,
      label,
      amount: fee.amount,
      status: registration.status === 'CANCELLED' ? 'CANCELLED' : 'PAID',
      method: fee.method,
      screenshot: fromProof(proof),
      uploadedBy: proof ? student : null,
      studentTransactionId: proof?.transactionId ?? null,
      approvedTransactionId: fee.reference ?? null,
      approvedBy: fee.verifiedBy,
      approvedAt: fee.verifiedAt,
      approvedAtDesk: null,
    };
  }
  const proof = latestProof(registration, eventId);
  return {
    kind: eventId,
    label,
    amount: fees.perEvent,
    status: proof ? 'WAITING' : 'UNPAID',
    method: proof ? 'UPI' : null,
    screenshot: fromProof(proof),
    uploadedBy: proof ? student : null,
    studentTransactionId: proof?.transactionId ?? null,
    approvedTransactionId: null,
    approvedBy: null,
    approvedAt: null,
    approvedAtDesk: null,
  };
}

/** The ₹100 gate pass: paid online (form screenshot), at the desk (cash, or GPay from Student login), or still waiting. */
function gatePassRecord(registration: Registration): PaymentRecordView {
  const student = registration.record.participant.name;
  const view = gatePassView(registration);
  const base = { kind: 'GATE_PASS', label: proofLabel('GATE_PASS', eventName), amount: view.amount };
  const { gatePass } = registration;
  if (gatePass) {
    const proof = proofById(registration, gatePass.proofId);
    return {
      ...base,
      status: view.status === 'CANCELLED' ? 'CANCELLED' : 'PAID',
      method: gatePass.method,
      screenshot: fromProof(proof),
      uploadedBy: proof ? student : null,
      studentTransactionId: proof?.transactionId ?? null,
      approvedTransactionId: gatePass.reference ?? null,
      approvedBy: gatePass.receivedBy,
      approvedAt: gatePass.receivedAt,
      approvedAtDesk: gatePass.desk ?? null,
    };
  }
  if (sourceOf(registration) === 'ONSITE') {
    const proof = latestProof(registration, 'GATE_PASS');
    return {
      ...base,
      status: view.status === 'AWAITING_VERIFICATION' ? (proof ? 'WAITING' : 'UNPAID') : view.status === 'VERIFIED' ? 'PAID' : view.status,
      method: 'UPI',
      screenshot: fromProof(proof),
      uploadedBy: proof ? student : null,
      studentTransactionId: proof?.transactionId ?? null,
      approvedTransactionId: null,
      approvedBy: view.verifiedBy,
      approvedAt: view.verifiedAt,
      approvedAtDesk: null,
    };
  }
  return {
    ...base,
    status: view.status === 'AWAITING_VERIFICATION' ? 'WAITING' : view.status === 'VERIFIED' ? 'PAID' : view.status,
    method: 'ONLINE_UPI',
    screenshot: registration.screenshot ? { source: 'ONLINE_FORM', proofId: null, uploadedAt: registration.submittedAt } : null,
    uploadedBy: registration.screenshot ? student : null,
    studentTransactionId: registration.record.payment.transactionId || null,
    approvedTransactionId: null,
    approvedBy: view.verifiedBy,
    approvedAt: view.verifiedAt,
    approvedAtDesk: null,
  };
}

/** Every payment of a registration with its evidence: the gate pass, then each current event. */
export function paymentRecords(registration: Registration, fees: Fees): PaymentRecordView[] {
  return [gatePassRecord(registration), ...currentEventIds(registration).map((eventId) => eventPaymentRecord(registration, eventId, fees))];
}
