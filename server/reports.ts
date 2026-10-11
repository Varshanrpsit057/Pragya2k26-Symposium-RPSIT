/**
 * The admin's report: registrations by source and status, the gate passes and event fees
 * received (and by whom, so every rupee of cash has a name against it), and attendance.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import type { ReportSummary } from '../src/lib/admin';
import { currentEventIds, isFeePaid, isPresent, participationOf, sourceOf } from './participation';
import type { EventResult, Registration } from './store';

export function buildReport(registrations: readonly Registration[], results: readonly EventResult[], now: number): ReportSummary {
  const approved = registrations.filter((registration) => registration.status === 'APPROVED');
  const collected = new Map<string, { username: string; cash: number; upi: number; count: number }>();
  const credit = (username: string, method: 'CASH' | 'UPI', amount: number) => {
    const entry = collected.get(username) ?? { username, cash: 0, upi: 0, count: 0 };
    if (method === 'CASH') entry.cash += amount;
    else entry.upi += amount;
    entry.count += 1;
    collected.set(username, entry);
  };

  const gatePass = { onlineVerified: { count: 0, amount: 0 }, deskCash: { count: 0, amount: 0 }, deskUpi: { count: 0, amount: 0 } };
  for (const registration of approved) {
    const { gatePass: desk } = registration;
    if (desk) {
      const bucket = desk.method === 'CASH' ? gatePass.deskCash : gatePass.deskUpi;
      bucket.count += 1;
      bucket.amount += desk.amount;
      credit(desk.receivedBy, desk.method, desk.amount);
    } else {
      gatePass.onlineVerified.count += 1;
      gatePass.onlineVerified.amount += registration.record.payment.gatePassAmount;
    }
  }

  const events = eventCatalog.map((event) => {
    const enrolled = approved.filter((registration) => currentEventIds(registration).includes(event.id));
    let cash = 0;
    let upi = 0;
    let cashAmount = 0;
    let upiAmount = 0;
    let amount = 0;
    for (const registration of enrolled) {
      const fee = participationOf(registration, event.id).fee;
      if (fee?.status !== 'PAID') continue;
      if (fee.method === 'CASH') {
        cash += 1;
        cashAmount += fee.amount;
      } else {
        upi += 1;
        upiAmount += fee.amount;
      }
      amount += fee.amount;
      credit(fee.verifiedBy, fee.method, fee.amount);
    }
    return {
      eventId: event.id,
      name: event.name,
      enrolled: enrolled.length,
      feesPaid: enrolled.filter((registration) => isFeePaid(registration, event.id)).length,
      cash,
      upi,
      cashAmount,
      upiAmount,
      amount,
      present: enrolled.filter((registration) => isPresent(registration, event.id)).length,
      resultStatus: results.find((result) => result.eventId === event.id)?.status ?? 'DRAFT',
    };
  });

  // Each registration desk: students registered there, and the gate passes received there.
  const desks = new Map<number, { desk: number; registrations: number; cashCount: number; cash: number; upiCount: number; upi: number }>();
  const desk = (number: number) => {
    const entry = desks.get(number) ?? { desk: number, registrations: 0, cashCount: 0, cash: 0, upiCount: 0, upi: 0 };
    desks.set(number, entry);
    return entry;
  };
  for (const registration of registrations) {
    if (registration.deskNumber && registration.status !== 'CANCELLED') desk(registration.deskNumber).registrations += 1;
  }
  for (const registration of approved) {
    const received = registration.gatePass;
    if (!received?.desk) continue;
    const entry = desk(received.desk);
    if (received.method === 'CASH') {
      entry.cashCount += 1;
      entry.cash += received.amount;
    } else {
      entry.upiCount += 1;
      entry.upi += received.amount;
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    registrations: {
      total: registrations.length,
      online: registrations.filter((registration) => sourceOf(registration) === 'ONLINE').length,
      onsite: registrations.filter((registration) => sourceOf(registration) === 'ONSITE').length,
      pending: registrations.filter((registration) => registration.status === 'PENDING').length,
      approved: approved.length,
      rejected: registrations.filter((registration) => registration.status === 'REJECTED').length,
      cancelled: registrations.filter((registration) => registration.status === 'CANCELLED').length,
    },
    gatePass,
    events,
    collectedBy: [...collected.values()].sort((a, b) => a.username.localeCompare(b.username)),
    desks: [...desks.values()].sort((a, b) => a.desk - b.desk),
  };
}
