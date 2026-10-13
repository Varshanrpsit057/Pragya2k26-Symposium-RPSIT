/**
 * The stream (degree) and department a student studies, chosen from searchable lists on the
 * registration forms. Stored together as the registration's "department / course": 'B.E. CSE'.
 */

export const OTHER = 'Other';

export const STREAMS: readonly string[] = [
  'B.E.',
  'B.Tech.',
  'M.E.',
  'M.Tech.',
  'B.Sc.',
  'M.Sc.',
  'BCA',
  'MCA',
  'B.Com.',
  'BBA',
  'MBA',
  'B.A.',
  'Diploma',
  'Ph.D.',
  OTHER,
];

/** Departments, with the short name (in brackets) that is stored when there is one. */
export const COURSE_DEPARTMENTS: readonly string[] = [
  'Computer Science and Engineering (CSE)',
  'Artificial Intelligence and Data Science (AI&DS)',
  'Artificial Intelligence and Machine Learning (AI&ML)',
  'Information Technology (IT)',
  'Cyber Security (CSE Cyber Security)',
  'Computer Science and Business Systems (CSBS)',
  'Computer Science and Design (CSD)',
  'Internet of Things (IoT)',
  'Electronics and Communication Engineering (ECE)',
  'Electrical and Electronics Engineering (EEE)',
  'Electronics and Instrumentation Engineering (EIE)',
  'Instrumentation and Control Engineering (ICE)',
  'VLSI Design and Technology (VLSI)',
  'Medical Electronics',
  'Mechanical Engineering (MECH)',
  'Mechatronics Engineering',
  'Automobile Engineering',
  'Aeronautical Engineering',
  'Aerospace Engineering',
  'Robotics and Automation',
  'Civil Engineering',
  'Chemical Engineering',
  'Biomedical Engineering',
  'Biotechnology',
  'Food Technology',
  'Agricultural Engineering',
  'Textile Technology',
  'Fashion Technology',
  'Petroleum Engineering',
  'Computer Science',
  'Computer Applications',
  'Data Science',
  'Mathematics',
  'Physics',
  'Chemistry',
  'Electronics',
  'Commerce',
  'Management',
  'English',
  OTHER,
];

/** 'Computer Science and Engineering (CSE)' → 'CSE'; 'Civil Engineering' stays as it is. */
export const shortDepartment = (department: string) => /\(([^)]+)\)\s*$/.exec(department)?.[1] ?? department;

/** The stream and department as stored: 'B.E.' + 'Computer Science and Engineering (CSE)' → 'B.E. CSE'. */
export function courseText(stream: string, department: string, other: string) {
  const dept = department === OTHER ? other.replace(/\s+/g, ' ').trim() : shortDepartment(department);
  return [stream === OTHER ? '' : stream, dept].filter(Boolean).join(' ').slice(0, 80);
}
