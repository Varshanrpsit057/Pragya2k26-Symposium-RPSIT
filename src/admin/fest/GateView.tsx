/**
 * Gate pass check (non-technical events, view only): every department's students with whether
 * their ₹100 entry fee is paid and verified. Type the Registration ID the student shows and the
 * answer is at the top; nothing here changes anything, and no phone numbers are shown.
 */
import { useCallback, useMemo, useState } from 'react';
import { deptShort, normaliseFestId, showId, type GateStudent } from '../../lib/fest';
import { Badge, ErrorNote, LiveStatus, useLiveData } from '../ui';
import { useFestCatalog } from './FestData';
import { gateList } from './festApi';
import { ShortList } from './festUi';

const STATUS: Record<GateStudent['status'], { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  PAID: { label: 'Paid', tone: 'good' },
  TO_CHECK: { label: 'Not verified yet', tone: 'warn' },
  DUE: { label: 'Not paid', tone: 'bad' },
};

/** What to tell the student, in one line. */
const advice = (student: GateStudent) =>
  student.status === 'PAID'
    ? 'Entry fee paid and verified: they can take part.'
    : student.status === 'TO_CHECK'
      ? `They sent a UPI payment, but a desk has not verified it yet: send them to the ${deptShort(student.dept)} registration desk.`
      : `Entry fee not paid: send them to the ${deptShort(student.dept)} registration desk to pay ₹100.`;

export function GateView({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const catalog = useFestCatalog();
  const live = useLiveData(
    useCallback(() => gateList(token), [token]),
    onSignedOut,
    30_000,
  );
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const students = useMemo(() => live.data?.students ?? [], [live.data]);
  const q = query.trim().toLowerCase();
  const wantedId = normaliseFestId(query);
  const shown = useMemo(
    () =>
      students.filter(
        (student) =>
          (!dept || student.dept === dept) &&
          (!q || student.id === wantedId || showId(student.id).toLowerCase().includes(q) || student.name.toLowerCase().includes(q) || student.college.toLowerCase().includes(q) || student.collegeCode.toLowerCase() === q),
      ),
    [students, dept, q, wantedId],
  );
  // The answer for the ID typed (or the only student found).
  const answer = wantedId ? students.find((student) => student.id === wantedId) : shown.length === 1 && q ? shown[0] : undefined;
  const counts = { PAID: 0, TO_CHECK: 0, DUE: 0 };
  for (const student of students) if (!dept || student.dept === dept) counts[student.status] += 1;

  return (
    <main className="adm-page fest-gate">
      <section className="adm-card adm-pad" aria-label="Gate pass check">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Gate pass check</h2>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <p className="adm-muted">Type the Registration ID on the student’s phone. View only: payments are taken and verified at each department’s desk.</p>
        <label className="adm-field fest-find">
          <span>Registration ID or name</span>
          <input type="search" value={query} placeholder="e.g. CSE-2001" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {answer ? (
          <div className={`fest-gate__answer is-${STATUS[answer.status].tone}`} role="status">
            <span className="fest-gate__status">{answer.status === 'PAID' ? '✓ ' : ''}{STATUS[answer.status].label}</span>
            <strong>
              <span className="fest-card__id">{showId(answer.id)}</span> {answer.name}
            </strong>
            <span>
              {deptShort(answer.dept)} · {answer.college}
              {answer.collegeCode && ` · college code ${answer.collegeCode}`}
            </span>
            <span>{advice(answer)}</span>
          </div>
        ) : (
          wantedId && live.data && <p className="fest-match is-bad" role="status">No registration {showId(wantedId)}: check the number with the student.</p>
        )}
        <ErrorNote error={live.error} />
      </section>

      <section className="adm-card adm-pad" aria-label="Students">
        <div className="adm-toolbar">
          <label className="adm-field">
            <span>Department</span>
            <select value={dept} onChange={(event) => setDept(event.target.value)}>
              <option value="">All departments</option>
              {catalog.departments.map((item) => (
                <option key={item.code} value={item.code}>
                  {deptShort(item.code)} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <span className="adm-muted">
            {counts.PAID} paid · {counts.TO_CHECK} not verified yet · {counts.DUE} not paid
          </span>
        </div>
        <ShortList
          items={shown}
          step={50}
          empty={live.data ? 'Nobody matches.' : 'Loading…'}
          render={(student) => (
            <article key={student.id} className="fest-card fest-card--compact">
              <header className="fest-card__head">
                <span className="fest-card__id">{showId(student.id)}</span>
                <strong className="fest-card__name">{student.name}</strong>
                <Badge tone={STATUS[student.status].tone}>{STATUS[student.status].label}</Badge>
              </header>
              <p className="fest-card__meta">
                {deptShort(student.dept)} · {student.college}
                {student.collegeCode && ` (${student.collegeCode})`}
              </p>
            </article>
          )}
        />
      </section>
    </main>
  );
}
