import { describe, expect, it } from 'vitest';
import { collegeKey, collegeSummary, deptShort, normaliseFestId, parseFestId, showId, type FestRegistration, type FestResult } from './fest';

const person = (id: string, college: string, extra: Partial<FestRegistration> = {}): FestRegistration => ({
  id,
  dept: parseFestId(id)?.dept ?? 'CSE',
  source: 'DESK',
  name: 'Student',
  phone: '9840000000',
  email: '',
  college,
  branch: '',
  year: '',
  team: '',
  entry: { status: 'PAID' },
  events: [],
  created: { at: '2026-10-17T04:00:00.000Z', by: 'cse-desk1' },
  v: 1,
  u: '2026-10-17T04:00:00.000Z',
  ...extra,
});
const result = (eventId: string, places: { place: number; ids: string[] }[], submitted = true): FestResult => ({
  eventId,
  dept: 'CSE',
  places,
  saved: { at: '2026-10-17T08:00:00.000Z', by: 'c' },
  ...(submitted && { submitted: { at: '2026-10-17T08:00:00.000Z', by: 'c' } }),
  v: 1,
  u: '2026-10-17T08:00:00.000Z',
});

describe('the college-wise view', () => {
  it('groups one college however it is typed, counts its students and the places it won (a team once)', () => {
    const people = [
      person('CSE-0001', 'Sona College of Technology, Salem'),
      person('CSE-0002', 'sona college of technology salem.'),
      person('20001', 'Sona College of Technology, Salem'),
      person('CSE-0003', 'Kongu Engineering College'),
      person('CSE-0004', 'Kongu Engineering College', { cancelled: { at: '', by: '', reason: 'duplicate' } }),
    ];
    const rows = collegeSummary(people, [
      result('cse-hackathon', [
        { place: 1, ids: ['CSE-0001', 'CSE-0002'] },
        { place: 2, ids: ['CSE-0003'] },
      ]),
      result('it-web-architects', [{ place: 1, ids: ['20001'] }]),
      result('cse-cyber-hunt', [{ place: 3, ids: ['CSE-0003'] }], false), // not submitted: does not count
    ]);
    expect(rows).toEqual([
      { key: collegeKey('Sona College of Technology, Salem'), name: 'Sona College of Technology, Salem', students: 3, first: 2, second: 0, third: 0, places: 2 },
      { key: 'kongu engineering college', name: 'Kongu Engineering College', students: 1, first: 0, second: 1, third: 0, places: 1 },
    ]);
  });
});

describe('IDs of students who registered themselves', () => {
  it('are five digits from 20001, read however they are typed', () => {
    expect(normaliseFestId(' 20017 ')).toBe('20017');
    expect(parseFestId('20017')).toEqual({ dept: 'OPEN', number: 20017 });
    expect(normaliseFestId('12345')).toBe('');
    expect(normaliseFestId('cse 12')).toBe('CSE-0012');
  });
});

describe('AI&DS', () => {
  it('is how the AIDS department reads everywhere, and is understood however an ID is typed', () => {
    expect(deptShort('AIDS')).toBe('AI&DS');
    expect(deptShort('CSE')).toBe('CSE');
    expect(showId('AIDS-0007')).toBe('AI&DS-0007');
    expect(showId('CSE-0007')).toBe('CSE-0007');
    expect(showId('20017')).toBe('20017');
    for (const typed of ['AI&DS-7', 'ai&ds 0007', 'AI & DS-7', 'AIDS-0007', 'aids 7']) expect(normaliseFestId(typed)).toBe('AIDS-0007');
    expect(deptShort('CYS')).toBe('CYBER');
    expect(showId('CYS-0012')).toBe('CYBER-0012');
    for (const typed of ['CYBER-12', 'cyber 0012', 'CYS-12']) expect(normaliseFestId(typed)).toBe('CYS-0012');
  });
});
