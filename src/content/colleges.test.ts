import { describe, expect, it } from 'vitest';
import { filterOptions } from '../components/ui/SearchSelect';
import { EMPTY_REGISTRATION, validateField } from '../lib/registration';
import { COLLEGES, NEARBY_COLLEGES, OTHER_COLLEGE, OTHER_COLLEGES, RENAMED_COLLEGES } from './colleges';

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

  it('has Hindusthan College of Technology (DGCT) beside Dhirajlal Gandhi College Of Technology, each found by its name', () => {
    expect(NEARBY_COLLEGES).toContain('Dhirajlal Gandhi College Of Technology, Salem');
    expect(NEARBY_COLLEGES).toContain('Hindusthan College of Technology (DGCT), Salem');
    expect(filterOptions(COLLEGES, 'dgct', true)[0]).toBe('Hindusthan College of Technology (DGCT), Salem');
    expect(filterOptions(COLLEGES, 'hindusthan technology salem', true)[0]).toBe('Hindusthan College of Technology (DGCT), Salem');
    expect(filterOptions(COLLEGES, 'dhirajlal', true)[0]).toBe('Dhirajlal Gandhi College Of Technology, Salem');
  });

  it('names each Mahendra college by its campus, the Salem one found by its old name (Maha College of Engineering) too', () => {
    const salem = 'Mahendra College of Engineering (formerly Maha College of Engineering), Minnampalli, Salem';
    expect(filterOptions(COLLEGES, 'mahendra', true)).toEqual([
      'Mahendra Arts and Science College, Kalippatti, Namakkal',
      salem,
      'Mahendra Engineering College for Women, Kumaramangalam, Tiruchengode',
      'Mahendra Engineering College, Mallasamudram, Namakkal',
      'Mahendra Institute of Engineering and Technology, Mallasamudram, Namakkal',
      'Mahendra Institute of Technology, Mallasamudram, Namakkal',
    ]);
    for (const typed of ['mahendra salem', 'mahendra minnampalli', 'mahendra college of engineering', 'maha college of engineering']) {
      expect(filterOptions(COLLEGES, typed, true)[0], typed).toBe(salem);
    }
    expect(filterOptions(COLLEGES, 'mahendra mallasamudram', true)).toHaveLength(3);
    expect(filterOptions(COLLEGES, 'irtt', true)[0]).toBe('Government College of Engineering, Erode (formerly Institute of Road and Transport Technology, IRTT)');
  });

  it('keeps every renamed college’s new name in the list, and none of the old names', () => {
    for (const [from, to] of Object.entries(RENAMED_COLLEGES)) {
      expect(COLLEGES, to).toContain(to);
      expect(COLLEGES, from).not.toContain(from);
    }
  });

  it('only holds names the registration form accepts', () => {
    for (const college of COLLEGES.filter((item) => item !== OTHER_COLLEGE)) {
      expect(validateField('college', { ...EMPTY_REGISTRATION, college }), college).toBeUndefined();
    }
  });
});
