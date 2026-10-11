import { describe, expect, it } from 'vitest';
import type { StudentView } from '../lib/student';
import { studentAlerts } from './alerts';

const DAY = '2026-10-17';
const at = (time: string) => Date.parse(`${DAY}T${time}:00+05:30`);

const view = (events: StudentView['events'], status: StudentView['status'] = 'APPROVED'): StudentView => ({
  registrationId: '262001',
  name: 'Nila R',
  college: 'Sona College of Technology, Salem',
  status,
  source: 'ONSITE',
  teamName: null,
  events,
  feePerEvent: 50,
  details: { department: 'CSE', year: 'III Year', phone: '9840012345', email: 'nila@example.com' },
  payAtLogin: null,
  passAvailable: status === 'APPROVED',
  reason: null,
  proofs: [],
});
const event = (eventId: string, name: string, feePaid = false) => ({ eventId, name, team: null, feePaid, present: false });

describe('student timing alerts', () => {
  const ROUNDS = 'Round 1 10:30 AM–11:30 AM, Round 2 12:00 PM–1:00 PM';

  it('says what is next and when to be there, which events overlap, and which fees are due', () => {
    const alerts = studentAlerts(view([event('pro-pitch', 'PRO-PITCH'), event('viz-craft', 'VIZ CRAFT', true), event('cognix', 'COGNIX')]), at('09:00'), DAY);
    expect(alerts).toEqual([
      { tone: 'next', text: 'Next: PRO-PITCH (Round 1) at 10:30 AM in Delta Lab (in 1 h 30 min). Be there by 10:00 AM.' },
      // Events at the same time: one first, then the other if time allows.
      { tone: 'clash', text: `PRO-PITCH and VIZ CRAFT run at the same time (${ROUNDS}). Attend one first, then move to the other if time allows: tell both coordinators.` },
      { tone: 'clash', text: `PRO-PITCH and COGNIX run at the same time (${ROUNDS}). Attend one first, then move to the other if time allows: tell both coordinators.` },
      { tone: 'clash', text: `VIZ CRAFT and COGNIX run at the same time (${ROUNDS}). Attend one first, then move to the other if time allows: tell both coordinators.` },
      { tone: 'pay', text: 'Pay ₹50 for PRO-PITCH and COGNIX: by GPay on this page (below), or in cash to the coordinator at the venue.' },
    ]);
    // Long events that only partly overlap: the one that ends first, then the other.
    expect(studentAlerts(view([event('pro-pitch', 'PRO-PITCH', true), event('paper-presentation', 'PAPER PRESENTATION', true)]), at('09:00'), DAY)[1]).toEqual({
      tone: 'clash',
      text: `PRO-PITCH (${ROUNDS}) and PAPER PRESENTATION (10:30 AM–12:30 PM) overlap. Both run for a while, so attend PAPER PRESENTATION first, then move to PRO-PITCH (on until 1:00 PM).`,
    });
  });

  it('says to head over when an event is close, and what is on now', () => {
    expect(studentAlerts(view([event('cognix', 'COGNIX', true)]), at('10:10'), DAY)).toEqual([
      { tone: 'soon', text: 'COGNIX (Round 1) starts at 10:30 AM in Theta Lab (in 20 min): head there now.' },
    ]);
    // Two rounds: on now during round 1, round 2 next after it.
    expect(studentAlerts(view([event('code-flex', 'CODE FLEX', true)]), at('11:00'), DAY)[0]).toEqual({
      tone: 'now',
      text: 'CODE FLEX (Round 1) is on now in Delta Lab, until 11:30 AM.',
    });
    expect(studentAlerts(view([event('code-flex', 'CODE FLEX', true)]), at('11:40'), DAY)[0].text).toBe('CODE FLEX (Round 2) starts at 12:00 PM in Delta Lab (in 20 min): head there now.');
  });

  it('ignores events that are over, and says when the day is done', () => {
    // At 1:10 PM every event is over, so nothing clashes or needs paying.
    const alerts = studentAlerts(view([event('pro-pitch', 'PRO-PITCH'), event('viz-craft', 'VIZ CRAFT')]), at('13:10'), DAY);
    expect(alerts).toEqual([{ tone: 'done', text: 'All your events are over for today. Thank you for taking part!' }]);
    expect(studentAlerts(view([event('cognix', 'COGNIX', true)]), at('16:00'), DAY)).toEqual([
      { tone: 'done', text: 'All your events are over for today. Thank you for taking part!' },
    ]);
  });

  it('shows the date before the event day, points to the venues without events, and stays quiet for others', () => {
    expect(studentAlerts(view([event('cognix', 'COGNIX', true)]), Date.parse('2026-10-15T12:00:00+05:30'), DAY)[0].text).toBe(
      'Next: COGNIX (Round 1) on 17 October at 10:30 AM in Theta Lab. Be there by 10:00 AM.',
    );
    expect(studentAlerts(view([]), at('09:00'), DAY)).toEqual([
      { tone: 'info', text: "You have not registered for any event yet. Go to an event's venue and register with its coordinator (₹50 per event)." },
    ]);
    expect(studentAlerts(view([event('cognix', 'COGNIX')], 'PENDING'), at('09:00'), DAY)).toEqual([]);
  });
});
