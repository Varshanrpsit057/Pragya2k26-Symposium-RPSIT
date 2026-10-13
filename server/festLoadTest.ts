/**
 * The load test's mock participants (Testing → Load test): believable students, most of them from
 * the colleges around Salem, each registered for their department with a mix of payments (paid at
 * a desk, UPI waiting for the desk, not paid yet), events, fees and attendance. Every one is marked
 * TEST, so "Delete the test data" removes them all. FestService.seedTest stores them, at most
 * MAX_TEST_PARTICIPANTS in all.
 */
import { COURSE_DEPARTMENTS, STREAMS, courseText } from '../src/content/courses';
import { NEARBY_COLLEGES } from '../src/content/colleges';
import { YEARS, type FestEntry, type FestEvent, type FestParticipant, type FestRegistration, type FestStamp } from '../src/lib/fest';

/** Test registrations at most: the load test never goes beyond it. */
export const MAX_TEST_PARTICIPANTS = 1000;

/** Most students come from these (Sona, Dhirajlal Gandhi, PMC Tech, Shreenivasa, GEC Salem). */
export const MAIN_COLLEGES: readonly string[] = [
  'Sona College of Technology, Salem',
  'Dhirajlal Gandhi College Of Technology, Salem',
  'Er. Perumal Manimekalai College of Engineering, Hosur',
  'Shreenivasa Engineering College, Dharmapuri',
  'Government College of Engineering, Salem',
];
/** Then the other colleges around Salem. */
const OTHER_NEARBY = NEARBY_COLLEGES.filter((college) => !MAIN_COLLEGES.includes(college));

const FIRST_NAMES = [
  'Aakash', 'Abinaya', 'Ajay', 'Akshaya', 'Arjun', 'Aruna', 'Ashwin', 'Bharathi', 'Deepak', 'Deepika', 'Dhanush', 'Divya', 'Gokul', 'Gowtham', 'Harini', 'Harish',
  'Indhu', 'Janani', 'Jeeva', 'Kavin', 'Kaviya', 'Keerthana', 'Kishore', 'Lakshmi', 'Madhan', 'Manoj', 'Meena', 'Mohan', 'Monisha', 'Naveen', 'Nila', 'Nithya',
  'Pavithra', 'Pradeep', 'Priya', 'Ragul', 'Ramya', 'Sakthi', 'Sanjay', 'Saranya', 'Sathish', 'Shalini', 'Sivakumar', 'Sneha', 'Surya', 'Swetha', 'Tamil', 'Vignesh',
  'Vijay', 'Vishnu', 'Yamini', 'Yuvaraj',
];
const COMMON_STREAMS = ['B.E.', 'B.E.', 'B.E.', 'B.Tech.', 'B.Tech.', 'B.Sc.', 'BCA', 'M.E.', 'MCA'].filter((stream) => STREAMS.includes(stream));
const COMMON_COURSES = COURSE_DEPARTMENTS.slice(0, 16);

type Random = () => number;
const pick = <T>(random: Random, list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

/** About 60% from the five main colleges, 35% from the other nearby ones, 5% from R P Sarathy itself. */
export function mockCollege(random: Random) {
  const roll = random();
  if (roll < 0.6) return pick(random, MAIN_COLLEGES);
  if (roll < 0.95 && OTHER_NEARBY.length) return pick(random, OTHER_NEARBY);
  return 'R P Sarathy Institute of Technology, Salem';
}

/** A student's details; `n` keeps the phone number and email unique within the run. */
export function mockParticipant(random: Random, n: number, phoneBase: number): FestParticipant {
  const first = pick(random, FIRST_NAMES);
  const initial = String.fromCharCode(65 + Math.floor(random() * 26));
  return {
    name: `${first} ${initial}`,
    // 6000000000 upwards: far from the numbers students usually have.
    phone: String(6_000_000_000 + ((phoneBase + n) % 999_999_999)),
    email: `${first.toLowerCase()}.${initial.toLowerCase()}${n}@example.com`,
    college: mockCollege(random),
    branch: courseText(pick(random, COMMON_STREAMS), pick(random, COMMON_COURSES), ''),
    year: pick(random, YEARS.slice(0, 4)),
    team: random() < 0.15 ? `Team ${pick(random, ['Nova', 'Pixel', 'Quantum', 'Vertex', 'Orbit', 'Spark'])}` : '',
  };
}

/** A 12-digit UTR starting with 9 (a load-test payment). */
export const mockUtr = (random: Random) => `9${String(Math.floor(random() * 1e11)).padStart(11, '0')}`;

/**
 * The rest of a mock registration: about 45% paid at a desk (cash or UPI) and checked in, 25% paid
 * by UPI on their phone and waiting for the desk, 30% not paid yet; 1 to 3 of their department's
 * events, the paid ones with some event fees and attendance.
 */
export function mockRegistration(
  random: Random,
  input: { id: string; dept: string; participant: FestParticipant; events: readonly FestEvent[]; entryFee: number; by: string; now: number; sid: string },
): FestRegistration {
  const { id, dept, participant, events, entryFee, by, now, sid } = input;
  const at = (minutesAgo: number): FestStamp => ({ at: new Date(now - minutesAgo * 60_000).toISOString(), by });
  const created = at(Math.floor(random() * 360) + 30);
  const roll = random();
  const desk = 1 + Math.floor(random() * 2);
  const paid = roll < 0.45;
  const waiting = !paid && roll < 0.7;
  const payment = paid ? { method: random() < 0.6 ? ('CASH' as const) : ('UPI' as const), amount: entryFee, ...at(Math.floor(random() * 25)), desk } : null;
  if (payment?.method === 'UPI') Object.assign(payment, { txn: mockUtr(random) });
  const chosen = [...events].sort(() => random() - 0.5).slice(0, Math.min(events.length, 1 + Math.floor(random() * 3)));
  const entries: FestEntry[] = chosen.map((event) => {
    const feeTaken = paid && (event.fee === 0 || random() < 0.6);
    return {
      eventId: event.id,
      added: created,
      ...(feeTaken && event.fee > 0 && { fee: { method: 'CASH' as const, amount: event.fee, ...at(Math.floor(random() * 20)) } }),
      ...(feeTaken && random() < 0.5 && { present: at(Math.floor(random() * 15)) }),
    };
  });
  return {
    id,
    dept,
    source: 'SELF',
    ...participant,
    entry: payment ? { status: 'PAID', payment } : waiting ? { status: 'DUE', claim: { txn: mockUtr(random), amount: entryFee, at: created.at } } : { status: 'DUE' },
    ...(payment && { checkedIn: { ...at(Math.floor(random() * 25)), desk } }),
    events: entries,
    created,
    sid,
    test: true,
    v: 1,
    u: new Date(now).toISOString(),
  };
}
