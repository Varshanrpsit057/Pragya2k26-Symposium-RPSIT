/**
 * The event day for coordinators (and admins): each event's participants, the ₹50 event fee,
 * attendance, winners, and the results submitted for certificates.
 *
 * Attendance is marked only after every check passes, in this order:
 *   1. the account may work on this event (coordinators: assigned events only)
 *   2. the event day has begun, and the event's results are not finalized
 *   3. the participant's ₹100 gate pass is verified (registration APPROVED)
 *   4. the participant is registered for this event
 *   5. this event's ₹50 fee is recorded as received by a coordinator
 *
 * A fee counts as paid only when a staff member confirms the money was received (in hand,
 * or seen credited for UPI); a UPI reference may be noted but is never the proof. Every
 * change records who made it and when. Results, once submitted, are locked until an admin
 * authorises a correction.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import { PLACES, PLACE_LABELS, type EventParticipant, type EventResultView, type EventRoster, type EventSummary, type FeeProofView, type Winners } from '../src/lib/admin';
import { REGISTRATION_ID, teamKey, teamNameProblem, tidy, type Fees } from '../src/lib/registration';
import { eventDayStarted, type RegistrationSchedule } from '../src/lib/schedule';
import { hasPermission } from '../src/lib/staff';
import { ApiError } from './errors';
import {
  attendanceView,
  currentEventIds,
  eventName,
  eventPaymentRecord,
  feeView,
  isFeePaid,
  isPresent,
  participationOf,
  recordWithEvents,
  sourceOf,
} from './participation';
import { canAccessEvent, requireAnyPermission, requireEvent, requirePermission, visibleEvents, type Actor } from './roles';
import type { EventResult, Registration, RegistrationChanges, ResultSubmission, Store } from './store';
import { readReceivedPayment } from './validate';

/** The most people one place can hold (a team). */
const MAX_PER_PLACE = 5;
/** Earlier submissions kept on an event's result after corrections. */
const MAX_PREVIOUS_SUBMISSIONS = 5;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const reasonOf = (body: unknown) => {
  const value = isObject(body) && typeof body.reason === 'string' ? body.reason : '';
  return value.slice(0, 300).replace(/\p{Cc}+/gu, ' ').trim();
};

/** The details a participant lookup shows a coordinator: their events and nothing private. */
export interface ParticipantLookup {
  success: true;
  registrationId: string;
  source: 'ONLINE' | 'ONSITE';
  status: Registration['status'];
  name: string;
  college: string;
  department: string;
  year: string;
  gatePassVerified: boolean;
  /** The team name given at the gate, if any. */
  teamName: string | null;
  /** The ₹100 gate pass: for checking a GPay payment made online against its screenshot. */
  payment: { amount: number; transactionId: string | null; hasScreenshot: boolean; proofId: string | null };
  events: {
    eventId: string;
    name: string;
    enrolled: boolean;
    team: string | null;
    fee: ReturnType<typeof feeView>;
    attendance: ReturnType<typeof attendanceView>;
    feeProof: FeeProofView | null;
  }[];
}

/** The student's latest GPay screenshot of an event's fee, while the fee is still unpaid. */
function feeProofOf(registration: Registration, eventId: string): FeeProofView | null {
  if (isFeePaid(registration, eventId)) return null;
  const proof = [...(registration.proofs ?? [])].reverse().find((item) => item.kind === eventId);
  return proof ? { id: proof.id, transactionId: proof.transactionId, uploadedAt: proof.uploadedAt } : null;
}

export interface EventDeskDeps {
  store: Store;
  fees: Fees;
  schedule: RegistrationSchedule;
  now: () => number;
  log: (message: string, details?: Record<string, unknown>) => void;
  /** Reads, checks and changes a registration safely against concurrent changes. */
  mutate: (registrationId: string, change: (current: Registration) => RegistrationChanges | null) => Promise<Registration>;
  required: (registrationId: string) => Promise<Registration>;
}

export const emptyResult = (eventId: string): EventResult => ({
  eventId,
  status: 'DRAFT',
  revision: 0,
  winners: { first: [], second: [], third: [] },
});

export function resultView(result: EventResult): EventResultView {
  return {
    eventId: result.eventId,
    status: result.status,
    revision: result.revision,
    winners: result.winners,
    savedBy: result.savedBy ?? null,
    savedAt: result.savedAt ?? null,
    submission: result.submission ?? null,
    previousSubmissions: (result.previousSubmissions ?? []).map(({ number, submittedBy, submittedAt }) => ({ number, submittedBy, submittedAt })),
    reopened:
      result.status === 'REOPENED' && result.reopenedBy
        ? { by: result.reopenedBy, at: result.reopenedAt ?? '', reason: result.reopenReason ?? '' }
        : null,
  };
}

export class EventDesk {
  constructor(private readonly deps: EventDeskDeps) {}

  private iso() {
    return new Date(this.deps.now()).toISOString();
  }

  private ensureEventDay() {
    if (!eventDayStarted(this.deps.schedule, this.deps.now())) {
      throw new ApiError(403, 'EVENT_NOT_STARTED', 'Event fees, attendance and winners open on the event day.');
    }
  }

  async loadResult(eventId: string): Promise<EventResult> {
    return (await this.deps.store.getEventResult(eventId)) ?? emptyResult(eventId);
  }

  private async ensureResultOpen(eventId: string) {
    const result = await this.loadResult(eventId);
    if (result.status === 'SUBMITTED') {
      const when = result.submission ? ` on ${result.submission.submittedAt} by ${result.submission.submittedBy}` : '';
      throw new ApiError(409, 'RESULTS_FINALIZED', `The results of ${eventName(eventId)} were submitted for certificates${when}. Ask an admin to authorise a correction.`);
    }
    return result;
  }

  /** Everyone registered for the event whose registration is not rejected or cancelled, by Registration ID. */
  private async registrationsFor(eventId: string): Promise<Registration[]> {
    const [approved, pending] = await Promise.all([this.deps.store.listRegistrations('APPROVED'), this.deps.store.listRegistrations('PENDING')]);
    return [...approved, ...pending]
      .filter((registration) => currentEventIds(registration).includes(eventId))
      .sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  }

  participantView(registration: Registration, eventId: string, actor: Actor): EventParticipant {
    const { participant } = registration.record;
    const participation = participationOf(registration, eventId);
    return {
      registrationId: registration.registrationId,
      source: sourceOf(registration),
      status: registration.status,
      name: participant.name,
      college: participant.college,
      department: participant.department,
      year: participant.year,
      ...((actor.role === 'COORDINATOR' || actor.role === 'ADMIN') && { phone: participant.phone }),
      ...((actor.role === 'CERTIFICATE' || actor.role === 'ADMIN') && { email: participant.email }),
      gatePassVerified: registration.status === 'APPROVED',
      addedBy: participation.addedBy ?? null,
      addedAt: participation.addedAt ?? null,
      team: participation.team ?? null,
      gateTeam: registration.teamName ?? null,
      fee: feeView(registration, eventId, this.deps.fees),
      attendance: attendanceView(registration, eventId),
      feeProof: feeProofOf(registration, eventId),
      ...(hasPermission(actor.role, 'events.operate') && { feePayment: eventPaymentRecord(registration, eventId, this.deps.fees) }),
    };
  }

  // -------------------------------------------------------------------------------------
  // Reading

  /** The events this account may see, with live counts and the state of their results. */
  async listEvents(actor: Actor): Promise<{ success: true; events: EventSummary[] }> {
    requireAnyPermission(actor, ['events.operate', 'results.view']);
    const approved = await this.deps.store.listRegistrations('APPROVED');
    const events = await Promise.all(
      visibleEvents(actor).map(async (event) => {
        const enrolled = approved.filter((registration) => currentEventIds(registration).includes(event.id));
        return {
          eventId: event.id,
          name: event.name,
          enrolled: enrolled.length,
          feePaid: enrolled.filter((registration) => isFeePaid(registration, event.id)).length,
          present: enrolled.filter((registration) => isPresent(registration, event.id)).length,
          result: resultView(await this.loadResult(event.id)),
        };
      }),
    );
    return { success: true, events };
  }

  /** One event's participants with their fee and attendance, and its results. */
  async roster(actor: Actor, eventId: string): Promise<{ success: true } & EventRoster> {
    const event = eventCatalog.find((item) => item.id === eventId);
    if (!event) throw new ApiError(404, 'NOT_FOUND', 'There is no such event.');
    requireAnyPermission(actor, ['events.operate', 'results.view']);
    if (!canAccessEvent(actor, eventId)) throw new ApiError(403, 'EVENT_NOT_ASSIGNED', 'This event is not assigned to your account.');
    const [registrations, result] = await Promise.all([this.registrationsFor(eventId), this.loadResult(eventId)]);
    return {
      success: true,
      event: { id: event.id, name: event.name },
      result: resultView(result),
      participants: registrations.map((registration) => this.participantView(registration, eventId, actor)),
      canOperate:
        hasPermission(actor.role, 'events.operate') && eventDayStarted(this.deps.schedule, this.deps.now()) && result.status !== 'SUBMITTED',
    };
  }

  /** A participant found by Registration ID, with their standing in the coordinator's events. */
  async lookup(actor: Actor, registrationId: string): Promise<ParticipantLookup> {
    requirePermission(actor, 'events.operate');
    const registration = await this.deps.required(registrationId);
    const { participant } = registration.record;
    const enrolledIds = currentEventIds(registration);
    return {
      success: true,
      registrationId: registration.registrationId,
      source: sourceOf(registration),
      status: registration.status,
      name: participant.name,
      college: participant.college,
      department: participant.department,
      year: participant.year,
      gatePassVerified: registration.status === 'APPROVED',
      teamName: registration.teamName ?? null,
      payment: {
        amount: registration.record.payment.gatePassAmount,
        // Only while it needs checking: coordinators see no transaction IDs otherwise.
        transactionId: registration.status === 'PENDING' ? registration.record.payment.transactionId || null : null,
        hasScreenshot: Boolean(registration.screenshot),
        // A desk registration paid by GPay from Student login: the student's latest screenshot.
        proofId:
          registration.status === 'PENDING' ? ([...(registration.proofs ?? [])].reverse().find((proof) => proof.kind === 'GATE_PASS')?.id ?? null) : null,
      },
      events: visibleEvents(actor).map((event) => ({
        eventId: event.id,
        name: event.name,
        enrolled: enrolledIds.includes(event.id),
        team: participationOf(registration, event.id).team ?? null,
        fee: feeView(registration, event.id, this.deps.fees),
        attendance: attendanceView(registration, event.id),
        feeProof: feeProofOf(registration, event.id),
      })),
    };
  }

  // -------------------------------------------------------------------------------------
  // Participants: enrol, event fee, attendance

  private gatePassCheck(registration: Registration) {
    if (registration.status !== 'APPROVED') {
      const state = registration.status === 'PENDING' ? 'is still awaiting verification' : registration.status === 'CANCELLED' ? 'was cancelled' : 'was rejected';
      throw new ApiError(409, 'GATE_PASS_NOT_VERIFIED', `The ₹100 gate pass of ${registration.registrationId} ${state}. Send the participant to the registration desk.`);
    }
  }

  private enrolledCheck(registration: Registration, eventId: string) {
    if (!currentEventIds(registration).includes(eventId)) {
      throw new ApiError(409, 'NOT_ENROLLED', `${registration.registrationId} is not registered for ${eventName(eventId)}. Add them to the event first.`);
    }
  }

  /** The team in a request: null for an individual entry, or a checked team name. */
  private readTeam(body: unknown, event: { id: string; name: string; teams?: { maxSize: number | null } }): string | null | undefined {
    if (!isObject(body) || body.team === undefined) return undefined;
    if (body.team === null || body.team === '') return null;
    const name = typeof body.team === 'string' ? body.team : '';
    const problem = teamNameProblem(name);
    if (problem) throw new ApiError(400, 'INVALID', problem);
    if (!event.teams) throw new ApiError(400, 'INDIVIDUAL_EVENT', `${event.name} is an individual event: enter the participant on their own.`);
    return tidy(name);
  }

  /** Refuses a team that already has as many members in this event as the rules allow (the desk checks too). */
  async ensureTeamRoom(event: { id: string; name: string; teams?: { maxSize: number | null } }, team: string, registrationId: string) {
    const maxSize = event.teams?.maxSize;
    if (!maxSize) return;
    const members = (await this.registrationsFor(event.id)).filter(
      (registration) => registration.registrationId !== registrationId && teamKey(participationOf(registration, event.id).team ?? '') === teamKey(team),
    );
    if (members.length >= maxSize) {
      throw new ApiError(409, 'TEAM_FULL', `Team "${team}" already has ${members.length} member${members.length === 1 ? '' : 's'} in ${event.name} (at most ${maxSize}).`);
    }
  }

  /**
   * At the venue: adds this event to a participant's registration (an on-the-spot event
   * registration), as an individual or with a team, and records the ₹50 fee in the same step
   * when `payment` is sent. Also sets or changes the team of someone already registered.
   * Each team member pays for themselves: a team is only a name the members share.
   */
  async enroll(actor: Actor, eventId: string, registrationId: string, body: unknown = {}) {
    const event = requireEvent(actor, eventId, 'events.operate');
    this.ensureEventDay();
    await this.ensureResultOpen(eventId);
    const team = this.readTeam(body, event);
    const payment = isObject(body) && body.payment !== undefined ? readReceivedPayment(body.payment) : null;
    if (payment && !payment.ok) throw new ApiError(400, 'PAYMENT_NOT_CONFIRMED', payment.error);
    if (team) await this.ensureTeamRoom(event, team, registrationId.toUpperCase());

    const updated = await this.deps.mutate(registrationId, (current) => {
      if (current.status === 'REJECTED' || current.status === 'CANCELLED') {
        const state = current.status === 'REJECTED' ? 'rejected' : 'cancelled';
        throw new ApiError(409, current.status, `${current.registrationId} was ${state} and cannot take part. Send the participant to the registration desk.`);
      }
      if (payment) this.gatePassCheck(current);
      const enrolled = currentEventIds(current).includes(eventId);
      const participation = participationOf(current, eventId);
      if (payment && participation.fee?.status === 'PAID') {
        throw new ApiError(409, 'ALREADY_PAID', `The ${eventName(eventId)} fee of ${current.registrationId} was already recorded by ${participation.fee.verifiedBy} at ${participation.fee.verifiedAt}.`);
      }
      const sameTeam = team === undefined || (team ?? null) === (participation.team ?? null);
      if (enrolled && sameTeam && !payment) return null;

      const next = { ...participation };
      if (!enrolled) Object.assign(next, { addedBy: actor.username, addedAt: this.iso() });
      if (team === null) delete next.team;
      else if (team !== undefined) next.team = team;
      if (payment?.ok) {
        next.fee = {
          status: 'PAID',
          method: payment.value.method,
          amount: this.deps.fees.perEvent,
          ...(payment.value.reference && { reference: payment.value.reference }),
          verifiedBy: actor.username,
          verifiedAt: this.iso(),
        };
      }
      const eventIds = currentEventIds({ eventIds: [...current.eventIds, eventId] });
      return {
        ...(!enrolled && { eventIds, record: recordWithEvents(current.record, eventIds, this.deps.fees) }),
        participation: { ...current.participation, [eventId]: next },
      };
    });
    this.deps.log('Participant entered in an event', {
      registrationId: updated.registrationId,
      eventId,
      team: Boolean(participationOf(updated, eventId).team),
      paid: Boolean(payment),
      by: actor.username,
    });
    return { success: true as const, participant: this.participantView(updated, eventId, actor) };
  }

  /** Records the ₹50 event fee as received: cash in hand, or UPI seen credited. */
  async recordFee(actor: Actor, eventId: string, registrationId: string, body: unknown) {
    requireEvent(actor, eventId, 'events.operate');
    this.ensureEventDay();
    await this.ensureResultOpen(eventId);
    const payment = readReceivedPayment(body);
    if (!payment.ok) throw new ApiError(400, 'PAYMENT_NOT_CONFIRMED', payment.error);
    const updated = await this.deps.mutate(registrationId, (current) => {
      this.gatePassCheck(current);
      this.enrolledCheck(current, eventId);
      const participation = participationOf(current, eventId);
      if (participation.fee?.status === 'PAID') {
        throw new ApiError(409, 'ALREADY_PAID', `The ${eventName(eventId)} fee of ${current.registrationId} was already recorded by ${participation.fee.verifiedBy} at ${participation.fee.verifiedAt}.`);
      }
      return {
        participation: {
          ...current.participation,
          [eventId]: {
            ...participation,
            fee: {
              status: 'PAID',
              method: payment.value.method,
              amount: this.deps.fees.perEvent,
              ...(payment.value.reference && { reference: payment.value.reference }),
              verifiedBy: actor.username,
              verifiedAt: this.iso(),
            },
          },
        },
      };
    });
    this.deps.log('Event fee received', { registrationId: updated.registrationId, eventId, method: payment.value.method, by: actor.username });
    return { success: true as const, participant: this.participantView(updated, eventId, actor) };
  }

  /**
   * A ₹50 fee the student paid by GPay from Student login: the coordinator checked their
   * screenshot and typed its transaction ID (never recorded for another payment), and may mark
   * them present in the same step.
   */
  async approveFeeScreenshot(actor: Actor, eventId: string, registrationId: string, body: unknown) {
    requireEvent(actor, eventId, 'events.operate');
    this.ensureEventDay();
    await this.ensureResultOpen(eventId);
    const proofId = isObject(body) && typeof body.proofId === 'string' ? body.proofId : '';
    const reference = isObject(body) && typeof body.reference === 'string' ? body.reference.replace(/\s+/g, '').toUpperCase() : '';
    const markPresent = isObject(body) && body.markPresent === true;
    if (!/^[A-Z0-9]{6,35}$/.test(reference)) {
      throw new ApiError(400, 'TRANSACTION_REQUIRED', 'Type the transaction ID (UPI reference / UTR) from the screenshot: 6–35 letters or digits.');
    }
    const id = registrationId.toUpperCase();
    const { store } = this.deps;
    const used = (holder: string) =>
      new ApiError(
        409,
        'DUPLICATE_TRANSACTION',
        holder === id ? `This transaction ID is already recorded for another payment of ${id}. Each payment can be recorded once.` : `This transaction ID was already used for ${holder}. Each payment can be recorded once.`,
        undefined,
        undefined,
        { registrationId: holder },
      );
    const holder = await store.findClaim('transaction', reference);
    if (holder) throw used(holder);
    if (!(await store.claim('transaction', reference, id))) throw used((await store.findClaim('transaction', reference)) ?? 'another registration');
    try {
      const updated = await this.deps.mutate(registrationId, (current) => {
        this.gatePassCheck(current);
        this.enrolledCheck(current, eventId);
        const participation = participationOf(current, eventId);
        if (participation.fee?.status === 'PAID') {
          throw new ApiError(409, 'ALREADY_PAID', `The ${eventName(eventId)} fee of ${current.registrationId} was already recorded by ${participation.fee.verifiedBy} at ${participation.fee.verifiedAt}.`);
        }
        if (!(current.proofs ?? []).some((proof) => proof.id === proofId && proof.kind === eventId)) {
          throw new ApiError(404, 'NO_SCREENSHOT', `There is no such ${eventName(eventId)} screenshot from ${current.registrationId}. Find them again.`);
        }
        const now = this.iso();
        return {
          participation: {
            ...current.participation,
            [eventId]: {
              ...participation,
              fee: { status: 'PAID', method: 'UPI', amount: this.deps.fees.perEvent, reference, proofId, verifiedBy: actor.username, verifiedAt: now },
              ...(markPresent && { attendance: { present: true, markedBy: actor.username, markedAt: now } }),
            },
          },
        };
      });
      this.deps.log('Event fee approved from the screenshot', { registrationId: updated.registrationId, eventId, present: markPresent, by: actor.username });
      return { success: true as const, participant: this.participantView(updated, eventId, actor) };
    } catch (error) {
      // Not recorded: the transaction ID may be used again.
      await store.releaseClaim('transaction', reference, id).catch(() => undefined);
      throw error;
    }
  }

  /** An admin cancels a fee recorded by mistake (kept in the fee's history, with the reason). */
  async voidFee(actor: Actor, eventId: string, registrationId: string, body: unknown) {
    requireEvent(actor, eventId, 'events.correct');
    await this.ensureResultOpen(eventId);
    const reason = reasonOf(body);
    if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Give the reason for voiding this fee.');
    let screenshotReference: string | undefined;
    const updated = await this.deps.mutate(registrationId, (current) => {
      const participation = participationOf(current, eventId);
      if (participation.fee?.status !== 'PAID') throw new ApiError(409, 'NOT_PAID', 'There is no event fee recorded to void.');
      screenshotReference = participation.fee.proofId ? participation.fee.reference : undefined;
      if (participation.attendance?.present) throw new ApiError(409, 'MARKED_PRESENT', 'Unmark the attendance first.');
      const voided = { ...participation.fee, status: 'VOIDED' as const, voidedBy: actor.username, voidedAt: this.iso(), voidReason: reason };
      const { fee: _fee, ...rest } = participation;
      void _fee;
      return { participation: { ...current.participation, [eventId]: { ...rest, feeHistory: [...(participation.feeHistory ?? []), voided] } } };
    });
    // A fee approved from a screenshot frees its transaction ID (it was recorded by mistake).
    if (screenshotReference) await this.deps.store.releaseClaim('transaction', screenshotReference, updated.registrationId);
    this.deps.log('Event fee voided', { registrationId: updated.registrationId, eventId, by: actor.username });
    return { success: true as const, participant: this.participantView(updated, eventId, actor) };
  }

  /** Marks a participant present (after every check) or takes the mark back before results are submitted. */
  async markAttendance(actor: Actor, eventId: string, registrationId: string, body: unknown) {
    requireEvent(actor, eventId, 'events.operate');
    this.ensureEventDay();
    const result = await this.ensureResultOpen(eventId);
    const present = isObject(body) ? body.present : undefined;
    if (typeof present !== 'boolean') throw new ApiError(400, 'INVALID', 'Say whether the participant is present.');
    const id = registrationId.toUpperCase();
    if (!present && PLACES.some((place) => result.winners[place].includes(id))) {
      throw new ApiError(409, 'IS_WINNER', `${id} is among the winners. Remove them from the winners first.`);
    }
    const updated = await this.deps.mutate(registrationId, (current) => {
      const participation = participationOf(current, eventId);
      if (present) {
        this.gatePassCheck(current);
        this.enrolledCheck(current, eventId);
        if (participation.fee?.status !== 'PAID') {
          throw new ApiError(409, 'EVENT_FEE_UNPAID', `Verify the ₹${this.deps.fees.perEvent} ${eventName(eventId)} fee of ${current.registrationId} before marking attendance.`);
        }
        if (participation.attendance?.present) return null;
      } else if (!participation.attendance?.present) {
        return null;
      }
      return {
        participation: {
          ...current.participation,
          [eventId]: { ...participation, attendance: { present, markedBy: actor.username, markedAt: this.iso() } },
        },
      };
    });
    this.deps.log(present ? 'Attendance marked' : 'Attendance unmarked', { registrationId: updated.registrationId, eventId, by: actor.username });
    return { success: true as const, participant: this.participantView(updated, eventId, actor) };
  }

  // -------------------------------------------------------------------------------------
  // Winners and results

  private readWinners(body: unknown): Winners {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The winners could not be read.');
    const winners: Winners = { first: [], second: [], third: [] };
    const seen = new Set<string>();
    for (const place of PLACES) {
      const raw = body[place] ?? [];
      if (!Array.isArray(raw) || raw.length > MAX_PER_PLACE) {
        throw new ApiError(400, 'INVALID', `${PLACE_LABELS[place]}: list up to ${MAX_PER_PLACE} Registration IDs.`);
      }
      for (const value of raw) {
        const id = typeof value === 'string' ? value.trim().toUpperCase() : '';
        if (!REGISTRATION_ID.test(id)) throw new ApiError(400, 'INVALID', `${PLACE_LABELS[place]}: "${String(value).slice(0, 20)}" is not a Registration ID.`);
        if (seen.has(id)) throw new ApiError(400, 'INVALID', `${id} is listed more than once.`);
        seen.add(id);
        winners[place].push(id);
      }
    }
    if ((!winners.first.length && (winners.second.length || winners.third.length)) || (!winners.second.length && winners.third.length)) {
      throw new ApiError(400, 'INVALID', 'Fill the places in order: first, then second, then third.');
    }
    return winners;
  }

  /** Every winner must be a verified participant of the event, marked present. */
  private async checkWinners(eventId: string, winners: Winners): Promise<Map<string, Registration>> {
    const found = new Map<string, Registration>();
    for (const id of PLACES.flatMap((place) => winners[place])) {
      const registration = await this.deps.store.getRegistration(id);
      if (!registration || registration.status !== 'APPROVED' || !currentEventIds(registration).includes(eventId)) {
        throw new ApiError(409, 'WINNER_NOT_ELIGIBLE', `${id} is not a verified participant of ${eventName(eventId)}.`);
      }
      if (!isPresent(registration, eventId)) {
        throw new ApiError(409, 'WINNER_NOT_ELIGIBLE', `${id} is not marked present at ${eventName(eventId)}.`);
      }
      found.set(id, registration);
    }
    return found;
  }

  /** Changes the event's result safely against concurrent changes. */
  private async changeResult(eventId: string, change: (current: EventResult) => EventResult): Promise<EventResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.loadResult(eventId);
      const next = { ...change(current), revision: current.revision + 1 };
      if (await this.deps.store.saveEventResult(next, current.revision)) return next;
    }
    throw new ApiError(409, 'BUSY', 'The results were changed by someone else at the same moment. Please reload and try again.');
  }

  /** Saves the winners as a draft (the coordinator can change them until submitting). */
  async saveWinners(actor: Actor, eventId: string, body: unknown) {
    requireEvent(actor, eventId, 'events.operate');
    this.ensureEventDay();
    const winners = this.readWinners(body);
    await this.checkWinners(eventId, winners);
    const saved = await this.changeResult(eventId, (current) => {
      if (current.status === 'SUBMITTED') {
        throw new ApiError(409, 'RESULTS_FINALIZED', `The results of ${eventName(eventId)} are already submitted. Ask an admin to authorise a correction.`);
      }
      return { ...current, winners, savedBy: actor.username, savedAt: this.iso() };
    });
    this.deps.log('Winners saved', { eventId, by: actor.username });
    return { success: true as const, result: resultView(saved) };
  }

  /**
   * Submits the event for certificate preparation: its participant list, attendance list
   * and winners, exactly as they stand now. The event is then locked.
   */
  async submit(actor: Actor, eventId: string) {
    requireEvent(actor, eventId, 'events.operate');
    this.ensureEventDay();
    const draft = await this.loadResult(eventId);
    if (draft.status === 'SUBMITTED') throw new ApiError(409, 'ALREADY_SUBMITTED', `The results of ${eventName(eventId)} are already submitted.`);
    if (!draft.winners.first.length) throw new ApiError(400, 'NO_WINNERS', 'Enter and save at least the first-place winner before submitting.');
    const winners = await this.checkWinners(eventId, draft.winners);
    const participants = (await this.registrationsFor(eventId)).filter((registration) => registration.status === 'APPROVED');

    const submitted = await this.changeResult(eventId, (current) => {
      if (current.status === 'SUBMITTED') throw new ApiError(409, 'ALREADY_SUBMITTED', `The results of ${eventName(eventId)} are already submitted.`);
      if (current.revision !== draft.revision) throw new ApiError(409, 'CHANGED', 'The winners changed while submitting. Please check them and submit again.');
      const entry = (id: string) => {
        const registration = winners.get(id)!;
        const { participant } = registration.record;
        return { registrationId: id, name: participant.name, college: participant.college, team: participationOf(registration, eventId).team ?? null };
      };
      const submission: ResultSubmission = {
        number: (current.submission?.number ?? 0) + 1,
        submittedBy: actor.username,
        submittedAt: this.iso(),
        participants: participants.map((registration) => ({
          registrationId: registration.registrationId,
          name: registration.record.participant.name,
          college: registration.record.participant.college,
          department: registration.record.participant.department,
          year: registration.record.participant.year,
          email: registration.record.participant.email,
          team: participationOf(registration, eventId).team ?? null,
          feePaid: isFeePaid(registration, eventId),
          present: isPresent(registration, eventId),
        })),
        attendance: participants.filter((registration) => isPresent(registration, eventId)).map((registration) => registration.registrationId),
        winners: { first: current.winners.first.map(entry), second: current.winners.second.map(entry), third: current.winners.third.map(entry) },
      };
      // Earlier submissions keep who, when and the winners; the full lists stay with the latest.
      const previous = current.submission
        ? [{ ...current.submission, participants: [] }, ...(current.previousSubmissions ?? [])].slice(0, MAX_PREVIOUS_SUBMISSIONS)
        : current.previousSubmissions;
      return { ...current, status: 'SUBMITTED', submission, ...(previous && { previousSubmissions: previous }) };
    });
    this.deps.log('Results submitted', { eventId, number: submitted.submission?.number, by: actor.username });
    return { success: true as const, result: resultView(submitted) };
  }

  /** An admin authorises a correction: the event unlocks until the coordinator submits again. */
  async reopen(actor: Actor, eventId: string, body: unknown) {
    requireEvent(actor, eventId, 'events.correct');
    const reason = reasonOf(body);
    if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Give the reason for the correction.');
    const reopened = await this.changeResult(eventId, (current) => {
      if (current.status !== 'SUBMITTED') throw new ApiError(409, 'NOT_SUBMITTED', 'These results are not submitted, so there is nothing to reopen.');
      return { ...current, status: 'REOPENED', reopenedBy: actor.username, reopenedAt: this.iso(), reopenReason: reason };
    });
    this.deps.log('Results reopened for correction', { eventId, by: actor.username });
    return { success: true as const, result: resultView(reopened) };
  }
}
