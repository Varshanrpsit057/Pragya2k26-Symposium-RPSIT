/**
 * A student's details as a form, for correcting them (a desk, a department admin, the web assist
 * team): the college, the stream and department, and the year are chosen from the same lists as the
 * registration forms, or typed (Other) when they are not listed. What was typed before and is not in
 * the lists stays as it is until it is changed.
 */
import { useState } from 'react';
import { COLLEGES, OTHER_COLLEGE, RENAMED_COLLEGES, collegeCodeOf } from '../../content/colleges';
import { COURSE_DEPARTMENTS, OTHER, STREAMS, courseText } from '../../content/courses';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { YEARS, participantProblems, readParticipant, type FestParticipant, type FestRegistration } from '../../lib/fest';

/** The college as the list has it (its new name if it was renamed), else Other with the name typed. */
function collegeChoice(college: string) {
  const listed = RENAMED_COLLEGES[college] ?? college;
  if (COLLEGES.includes(listed)) return { choice: listed, other: '' };
  return { choice: college ? OTHER_COLLEGE : '', other: college };
}

/** 'B.E. CSE' → B.E. + Computer Science and Engineering (CSE); anything else is kept as typed (Other). */
function courseChoice(branch: string) {
  for (const stream of ['', ...STREAMS.filter((item) => item !== OTHER)]) {
    for (const dept of COURSE_DEPARTMENTS) if (dept !== OTHER && courseText(stream, dept, '') === branch) return { stream, dept, other: '' };
  }
  return { stream: '', dept: branch ? OTHER : '', other: branch };
}

export function ParticipantEditor({
  registration,
  busy = false,
  onSave,
  onCancel,
}: {
  registration: FestRegistration;
  busy?: boolean;
  onSave: (participant: FestParticipant) => void;
  onCancel: () => void;
}) {
  const id = `edit-${registration.id}`;
  const [form, setForm] = useState({ name: registration.name, phone: registration.phone, email: registration.email, collegeCode: registration.collegeCode || collegeCodeOf(registration.college), regNo: registration.regNo ?? '', year: registration.year, team: registration.team });
  const [college, setCollege] = useState(() => collegeChoice(registration.college));
  const [course, setCourse] = useState(() => courseChoice(registration.branch));
  const branch = course.dept === OTHER && !course.stream ? course.other : courseText(course.stream, course.dept, course.other);
  const participant = readParticipant({ ...form, college: college.choice === OTHER_COLLEGE ? college.other : college.choice, branch });
  const problems = participantProblems(participant);
  const years: string[] = [...YEARS];
  if (registration.year && !years.includes(registration.year)) years.push(registration.year);
  const text = (field: 'name' | 'phone' | 'email' | 'collegeCode' | 'regNo' | 'team', label: string, extra: Record<string, unknown> = {}) => (
    <label className="adm-field">
      <span>{label}</span>
      <input value={form[field]} autoComplete="off" onChange={(event) => setForm({ ...form, [field]: event.target.value })} {...extra} />
      {problems[field] && <span className="adm-field__error">{problems[field]}</span>}
    </label>
  );

  return (
    <div className="fest-form" aria-label={`Correct ${registration.name}’s details`}>
      {text('name', 'Name')}
      {text('phone', 'Mobile number', { inputMode: 'tel' })}
      {text('email', 'Email', { type: 'email', inputMode: 'email', autoCapitalize: 'none' })}
      <div className="adm-field">
        <span id={`${id}-college-label`}>College</span>
        <SearchSelect
          id={`${id}-college`}
          labelId={`${id}-college-label`}
          options={COLLEGES}
          value={college.choice}
          onChange={(choice) => {
            setCollege({ ...college, choice });
            // A listed college fills in its code (it can still be changed).
            const code = collegeCodeOf(choice);
            if (code && choice !== college.choice) setForm({ ...form, collegeCode: code });
          }}
          placeholder="Choose… (type to find it)"
          searchPlaceholder="College name or initials"
          searchLabel="Search colleges"
          emptyText={(query) => `No college matches “${query}”. Choose ${OTHER_COLLEGE} and type it.`}
          bestFirst
          searchFirst
        />
        {college.choice !== OTHER_COLLEGE && problems.college && <span className="adm-field__error">{problems.college}</span>}
      </div>
      {college.choice === OTHER_COLLEGE && (
        <label className="adm-field">
          <span>Their college (as it is not listed)</span>
          <input value={college.other} maxLength={150} autoComplete="off" onChange={(event) => setCollege({ ...college, other: event.target.value })} />
          {problems.college && <span className="adm-field__error">{problems.college}</span>}
        </label>
      )}
      <div className="fest-form__row">
        {text('collegeCode', 'College code', { maxLength: 12, autoCapitalize: 'characters', spellCheck: false, placeholder: 'e.g. 2639' })}
        {text('regNo', 'Register number (optional)', { maxLength: 24, inputMode: 'numeric', autoCapitalize: 'characters', spellCheck: false })}
      </div>
      <div className="fest-form__row">
        <div className="adm-field">
          <span id={`${id}-stream-label`}>Stream</span>
          <SearchSelect id={`${id}-stream`} labelId={`${id}-stream-label`} options={STREAMS} value={course.stream} onChange={(stream) => setCourse({ ...course, stream })} placeholder="B.E., B.Sc.…" searchPlaceholder="Search streams" searchLabel="Search streams" />
        </div>
        <div className="adm-field">
          <span id={`${id}-course-label`}>Department / course</span>
          <SearchSelect
            id={`${id}-course`}
            labelId={`${id}-course-label`}
            options={COURSE_DEPARTMENTS}
            value={course.dept}
            onChange={(dept) => setCourse({ ...course, dept })}
            placeholder="CSE, ECE…"
            searchPlaceholder="Search departments"
            searchLabel="Search departments"
            bestFirst
          />
        </div>
      </div>
      {course.dept === OTHER && (
        <label className="adm-field">
          <span>Their department / course (as it is not listed)</span>
          <input value={course.other} maxLength={80} autoComplete="off" onChange={(event) => setCourse({ ...course, other: event.target.value })} />
        </label>
      )}
      <label className="adm-field">
        <span>Year</span>
        <select value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })}>
          <option value="">Choose</option>
          {years.map((year) => (
            <option key={year}>{year}</option>
          ))}
        </select>
      </label>
      {text('team', 'Team (typed when registering)')}
      <div className="adm-inline">
        <button className="adm-button adm-button--primary" type="button" disabled={busy || Object.keys(problems).length > 0} onClick={() => onSave(participant)}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
        <button className="adm-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
