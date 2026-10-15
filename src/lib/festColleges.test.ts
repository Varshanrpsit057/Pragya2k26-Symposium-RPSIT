import { describe, expect, it } from 'vitest';
import { collegeKey, collegeSummary, deptShort, medalOrder, normaliseFestId, parseFestId, placeTeam, showId, sourceOfNumber, teamKey, teamsOf, teamsText, tidyTeamName, type CollegeRow, type FestRegistration, type FestResult } from './fest';

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
      person('IT-2001', 'Sona College of Technology, Salem'),
      person('CSE-0003', 'Kongu Engineering College'),
      person('CSE-0004', 'Kongu Engineering College', { cancelled: { at: '', by: '', reason: 'duplicate' } }),
    ];
    const rows = collegeSummary(people, [
      result('cse-hackathon', [
        { place: 1, ids: ['CSE-0001', 'CSE-0002'] },
        { place: 2, ids: ['CSE-0003'] },
      ]),
      result('it-web-architects', [{ place: 1, ids: ['IT-2001'] }]),
      result('cse-cyber-hunt', [{ place: 3, ids: ['CSE-0003'] }], false), // not submitted: does not count
    ]);
    expect(rows).toEqual([
      { key: collegeKey('Sona College of Technology, Salem'), name: 'Sona College of Technology, Salem', code: '', students: 3, registrations: 0, participations: 0, first: 2, second: 0, third: 0, places: 2 },
      { key: 'kongu engineering college', name: 'Kongu Engineering College', code: '', students: 1, registrations: 0, participations: 0, first: 0, second: 1, third: 0, places: 1 },
    ]);
  });

  it('counts each college’s event participations (attended) and registrations', () => {
    const stamp = { at: '2026-10-17T05:00:00.000Z', by: 'c' };
    const rows = collegeSummary(
      [
        person('CSE-2001', 'DGCT', { events: [{ eventId: 'cse-hackathon', added: stamp, present: stamp }, { eventId: 'cse-cyber-hunt', added: stamp }] }),
        person('CSE-2002', 'DGCT', { events: [{ eventId: 'cse-hackathon', added: stamp, present: stamp }] }),
      ],
      [],
    );
    expect(rows).toEqual([expect.objectContaining({ name: 'DGCT', students: 2, registrations: 3, participations: 2 })]);
  });

  it('ranks colleges like a medal table: most 1st prizes, then 2nd, then 3rd, then participations, then students', () => {
    const row = (name: string, students: number, participations: number, first: number, second: number, third: number): CollegeRow => ({
      key: name.toLowerCase(),
      name,
      code: '',
      students,
      registrations: participations,
      participations,
      first,
      second,
      third,
      places: first + second + third,
    });
    const dgct = row('DGCT', 74, 139, 20, 15, 10);
    const ranked = [
      row('More students, fewer 2nd', 120, 300, 20, 14, 30),
      dgct,
      row('Most 1st', 10, 12, 21, 0, 0),
      row('Same prizes, more participations', 60, 140, 20, 15, 10),
      row('Same prizes and participations, fewer students', 70, 139, 20, 15, 10),
    ].sort(medalOrder);
    expect(ranked.map((item) => item.name)).toEqual(['Most 1st', 'Same prizes, more participations', 'DGCT', 'Same prizes and participations, fewer students', 'More students, fewer 2nd']);
  });
});

describe('IDs of students who registered on their phones', () => {
  it('are their department’s, from 2001 (desks 0001–1999, online 5001…, paper 9001…)', () => {
    expect(normaliseFestId(' cse 2017 ')).toBe('CSE-2017');
    expect(parseFestId('CSE-2017')).toEqual({ dept: 'CSE', number: 2017 });
    expect(sourceOfNumber(2017)).toBe('SELF');
    expect(sourceOfNumber(1999)).toBe('DESK');
    expect(sourceOfNumber(5001)).toBe('ONLINE');
    expect(normaliseFestId('20017')).toBe('');
  });
});

describe('AI&DS', () => {
  it('is how the AIDS department reads everywhere, and is understood however an ID is typed', () => {
    expect(deptShort('AIDS')).toBe('AI&DS');
    expect(deptShort('CSE')).toBe('CSE');
    expect(showId('AIDS-0007')).toBe('AI&DS-0007');
    expect(showId('CSE-0007')).toBe('CSE-0007');
    expect(showId('AIDS-2001')).toBe('AI&DS-2001');
    for (const typed of ['AI&DS-7', 'ai&ds 0007', 'AI & DS-7', 'AIDS-0007', 'aids 7']) expect(normaliseFestId(typed)).toBe('AIDS-0007');
    expect(deptShort('CYS')).toBe('CYBER');
    expect(showId('CYS-0012')).toBe('CYBER-0012');
    for (const typed of ['CYBER-12', 'cyber 0012', 'CYS-12']) expect(normaliseFestId(typed)).toBe('CYS-0012');
    expect(deptShort('SH')).toBe('S&H');
    expect(showId('SH-2001')).toBe('S&H-2001');
    for (const typed of ['S&H-2001', 's & h 2001', 'SH-2001']) expect(normaliseFestId(typed)).toBe('SH-2001');
  });
});

describe('teams (for one event only, and optional)', () => {
  const stamp = { at: '2026-10-17T05:00:00.000Z', by: 'cse-hack' };
  const inHack = (team?: string) => [{ eventId: 'cse-hackathon', added: stamp, ...(team && { team }) }];

  it('groups an event’s participants by team name, whatever the capitals; the rest are on their own', () => {
    const people = [
      person('CSE-2002', 'Sona', { events: inHack('Nova') }),
      person('CSE-2001', 'Sona', { events: inHack('nova') }),
      person('CSE-2003', 'Sona', { events: inHack() }),
      person('CSE-2004', 'Sona', { events: inHack('Bits'), cancelled: { ...stamp, reason: 'left' } }),
      person('CSE-2005', 'Sona', { events: [{ eventId: 'cse-cyber-hunt', added: stamp, team: 'Nova' }] }),
    ];
    const teams = teamsOf(people, 'cse-hackathon');
    // Cancelled students and other events' teams are left out; members by ID.
    expect(teams.map((team) => [team.name, team.members.map((item) => item.id)])).toEqual([['Nova', ['CSE-2001', 'CSE-2002']]]);
    expect(teamKey('  NOVA  ')).toBe('nova');
    expect(tidyTeamName('  Byte   Me ')).toBe('Byte Me');
  });

  it('names a winning team, or "Individual" for one student on their own', () => {
    expect(placeTeam({ ids: ['CSE-2001', 'CSE-2002'], team: 'Nova' })).toBe('Nova');
    expect(placeTeam({ ids: ['CSE-2003'] })).toBe('Individual');
    expect(placeTeam({ ids: ['CSE-2001', 'CSE-2002'] })).toBe('');
  });

  it('shows a student’s teams by event, or the name they typed when registering, marked so', () => {
    const name = (eventId: string) => (eventId === 'cse-hackathon' ? 'Hackathon' : 'Cyber Hunt');
    expect(teamsText(person('CSE-2001', 'Sona', { team: 'Old', events: [...inHack('Nova'), { eventId: 'cse-cyber-hunt', added: stamp, team: 'Bits' }] }), name)).toBe('Nova (Hackathon); Bits (Cyber Hunt)');
    expect(teamsText(person('CSE-2002', 'Sona', { team: 'Old', events: inHack() }), name)).toBe('Old (typed when registering)');
    expect(teamsText(person('CSE-2003', 'Sona', { events: inHack() }), name)).toBe('');
  });
});
