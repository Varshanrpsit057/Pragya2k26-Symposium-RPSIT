/**
 * Each student's record as a JSON file in Google Drive ("Student Records"): who they are, how
 * and when they registered, every payment with its evidence (screenshot, the transaction ID
 * they typed, the one the staff entered, who approved it) and each event with its fee and
 * attendance. A complete copy kept up to date beside the database and the Google Sheet, so
 * no data is lost even if one of them were; a deleted record keeps its file, marked deleted.
 */
import { proofLabel } from '../src/lib/student';
import type { Fees } from '../src/lib/registration';
import { driveLink } from './drive';
import { currentEventIds, eventName, isPresent, participationOf, paymentRecords, sourceOf } from './participation';
import type { Registration } from './store';

export const RECORD_FORMAT = 'pragya-2026-student-record';
export const RECORD_FOLDER_NAME = 'Student Records';

/** "262001 Kavin S.json" (characters Drive dislikes in names are dropped). */
export const recordFileName = (registration: Registration) =>
  `${registration.registrationId} ${registration.record.participant.name}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() + '.json';

export interface Deletion {
  at: string;
  by: string;
  reason: string;
}

export function studentRecord(registration: Registration, fees: Fees, savedAt: string, deleted: Deletion | null = null) {
  const { participant } = registration.record;
  const eventIds = currentEventIds(registration);
  const proofFile = (proofId: string | null) => {
    const fileId = proofId ? (registration.proofs ?? []).find((proof) => proof.id === proofId)?.driveFileId : undefined;
    return fileId ? driveLink(fileId) : null;
  };
  return {
    format: RECORD_FORMAT,
    savedAt,
    registrationId: registration.registrationId,
    status: deleted ? 'DELETED' : registration.status,
    source: sourceOf(registration),
    registeredAt: registration.submittedAt,
    /** The desk member who registered them (on-site); null for online. */
    registeredBy: registration.createdBy ?? null,
    student: {
      name: participant.name,
      college: participant.college,
      department: participant.department,
      year: participant.year,
      phone: participant.phone,
      email: participant.email,
      gateTeam: registration.teamName ?? null,
    },
    review: {
      approvedAt: registration.approvedAt ?? null,
      rejectedAt: registration.rejectedAt ?? null,
      by: registration.reviewedBy ?? null,
      rejectionReason: registration.rejectionReason ?? null,
    },
    cancelled: registration.cancelledAt ? { at: registration.cancelledAt, by: registration.cancelledBy ?? null, reason: registration.cancellationReason ?? null } : null,
    deleted,
    payments: paymentRecords(registration, fees).map((record) => ({
      ...record,
      screenshotDriveLink:
        record.screenshot?.source === 'ONLINE_FORM'
          ? registration.paymentDriveFileId
            ? driveLink(registration.paymentDriveFileId)
            : null
          : proofFile(record.screenshot?.proofId ?? null),
    })),
    events: eventIds.map((eventId) => {
      const participation = participationOf(registration, eventId);
      return {
        eventId,
        name: eventName(eventId),
        team: participation.team ?? null,
        addedBy: participation.addedBy ?? null,
        addedAt: participation.addedAt ?? null,
        feePaid: participation.fee?.status === 'PAID',
        attended: participation.attendance?.present === true,
        attendance: participation.attendance ?? null,
        voidedFees: (participation.feeHistory ?? []).filter((fee) => fee.status === 'VOIDED'),
      };
    }),
    eventsAttended: eventIds.filter((eventId) => isPresent(registration, eventId)).map(eventName),
    discontinuedEvents: registration.record.nonTechnicalEvents ?? [],
    screenshots: (registration.proofs ?? []).map((proof) => ({
      label: proofLabel(proof.kind, eventName),
      uploadedAt: proof.uploadedAt,
      transactionId: proof.transactionId,
      driveLink: proof.driveFileId ? driveLink(proof.driveFileId) : null,
    })),
    pass: {
      status: registration.pdfStatus,
      generatedAt: registration.pdfGeneratedAt ?? null,
      driveLink: registration.passDriveFileId ? driveLink(registration.passDriveFileId) : null,
    },
  };
}
