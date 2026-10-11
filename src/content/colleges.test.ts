import { describe, expect, it } from 'vitest';
import { filterOptions } from '../components/ui/SearchSelect';
import { EMPTY_REGISTRATION, validateField } from '../lib/registration';
import { COLLEGES, NEARBY_COLLEGES, OTHER_COLLEGE, OTHER_COLLEGES } from './colleges';

describe('Tamil Nadu colleges', () => {
  it('lists every college once, the host college first and the colleges near Salem before the rest', () => {
    expect(new Set(COLLEGES).size).toBe(COLLEGES.length);
    expect(COLLEGES[0]).toBe('R P Sarathy Institute of Technology, Salem');
    expect(COLLEGES.at(-1)).toBe(OTHER_COLLEGE);
    expect(COLLEGES.length).toBeGreaterThan(550);
    for (const town of ['Salem', 'Dharmapuri', 'Erode', 'Namakkal', 'Krishnagiri', 'Hosur', 'Tiruchengode']) {
      expect(NEARBY_COLLEGES.some((college) => college.includes(town)), town).toBe(true);
    }
    expect(NEARBY_COLLEGES).toContain('Kongu Engineering College, Perundurai');
    expect(NEARBY_COLLEGES).toContain('K.S. Rangasamy College of Technology, Tiruchengode');
    expect(NEARBY_COLLEGES).toContain('Adhiyamaan College of Engineering, Hosur');
    expect(OTHER_COLLEGES).toContain('P.S.G. College of Technology, Coimbatore');
    expect(OTHER_COLLEGES.some((college) => /Salem|Dharmapuri|Krishnagiri|Hosur|Tiruchengode/.test(college))).toBe(false);
  });

  it('only holds names the registration form accepts', () => {
    for (const college of COLLEGES.filter((item) => item !== OTHER_COLLEGE)) {
      expect(validateField('college', { ...EMPTY_REGISTRATION, college }), college).toBeUndefined();
    }
  });

  it('finds a college from its first letters or its initials, best match first', () => {
    expect(filterOptions(COLLEGES, 'sona', true)[0]).toBe('Sona College of Technology, Salem');
    expect(filterOptions(COLLEGES, 'psg', true)[0]).toBe('P.S.G. College of Technology, Coimbatore');
    // 'ksr' finds the K.S.R. colleges and K.S. Rangasamy (KSRCT), all ahead of anything else.
    expect(new Set(filterOptions(COLLEGES, 'ksr', true).slice(0, 4))).toEqual(
      new Set([
        'K S R Institute For Engineering And Technology, Tiruchengode',
        'K.S. Rangasamy College of Technology, Tiruchengode',
        'K.S.R. College of Arts and Science, Tiruchengode',
        'K.S.R. College of Engineering, Tiruchengode',
      ]),
    );
    // Without best-first (the Department list) the matches keep their order.
    expect(filterOptions(['Computer Science and Engineering (Cyber Security)', 'Cyber Security'], 'cyber')).toEqual([
      'Computer Science and Engineering (Cyber Security)',
      'Cyber Security',
    ]);
    expect(filterOptions(['Computer Science and Engineering (Cyber Security)', 'Cyber Security'], 'cyber', true)[0]).toBe('Cyber Security');
  });
});
