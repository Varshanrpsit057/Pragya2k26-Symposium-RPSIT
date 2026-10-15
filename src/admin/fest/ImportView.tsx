/**
 * Online registrations (department admins and the web assist team): the students who registered
 * with the online form, typed in one at a time or brought in from the form's CSV. Each gets the
 * next online ID ({dept}-5001…); the ₹100 entry fee counts as paid online (its UTR kept); event
 * fees are paid at each venue, online registrations too.
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { COLLEGES, OTHER_COLLEGE } from '../../content/colleges';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { deptShort, eventLabel, eventsOf, guessColumns, IMPORT_FIELDS, parseCsv, participantProblems, readParticipant, rupees, showId, toCsv, YEARS, type ImportField } from '../../lib/fest';
import { tidyUtr } from '../../lib/portal';
import { ApiFailure, SignedOut } from '../adminApi';
import { saveFile } from '../ui';
import { DeptPicker, useWorkDept } from './DeskView';
import { importFest, type ImportOutcome, type ImportRow } from './festApi';
import { useFest } from './FestData';

const BLANK = { name: '', phone: '', email: '', collegeCode: '', branch: '', year: '', ref: '', utr: '' };

/**
 * One online registration typed in from the online form (e.g. when its CSV cannot be used): the
 * student gets the next online ID ({dept}-5001…), their ₹100 entry fee counts as paid online (its
 * UTR kept), and the events they chose are added, each fee to be paid at the venue.
 */
function TypeOneIn({ dept, token, onSignedOut }: { dept: string; token: string; onSignedOut: () => void }) {
  const { catalog, refresh } = useFest();
  const [form, setForm] = useState(BLANK);
  const [college, setCollege] = useState({ choice: '', other: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<{ id: string; name: string }[]>([]);
  const events = catalog ? eventsOf(catalog, dept) : [];
  const collegeName = college.choice === OTHER_COLLEGE ? college.other.replace(/\s+/g, ' ').trim() : college.choice;
  const participant = readParticipant({ ...form, college: collegeName, team: '' });
  const problems: Partial<Record<string, string>> = participantProblems(participant);
  const utr = tidyUtr(form.utr).toUpperCase();
  if (utr && !/^[A-Z0-9]{6,35}$/.test(utr)) problems.utr = 'Check the UTR (the UPI transaction ID: 12 digits).';
  const field = (name: string) => (tried && problems[name] ? <span className="adm-field__error">{problems[name]}</span> : null);
  const set = (change: Partial<typeof BLANK>) => setForm((current) => ({ ...current, ...change }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setError('');
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const [outcome] = await importFest(token, {
        dept,
        dryRun: false,
        rows: [{ row: 1, ...participant, team: '', events: picked.join(';'), utr, ref: form.ref.trim() }],
      });
      if (outcome?.status === 'created' && outcome.id) {
        setAdded((current) => [{ id: outcome.id!, name: participant.name }, ...current]);
        setForm(BLANK);
        setCollege({ choice: '', other: '' });
        setPicked([]);
        setTried(false);
        refresh();
      } else {
        setError(outcome?.status === 'duplicate' ? `Already registered: ${outcome.message ?? ''}` : (outcome?.message ?? 'It could not be added.'));
      }
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure instanceof ApiFailure || failure instanceof Error ? failure.message : 'It could not be added.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="adm-card adm-pad fest-form" aria-label="Type in an online registration" onSubmit={(event) => void submit(event)} noValidate>
      <h2 className="adm-h2">Type in an online registration</h2>
      <p className="adm-muted">
        From the online form, one student at a time. They get the next {deptShort(dept)}-5001… ID; their {catalog ? rupees(catalog.entryFee) : '₹100'} entry fee counts as paid online. Event fees are paid
        at each venue.
      </p>
      <div className="fest-form__row">
        <label className="adm-field">
          <span>Name with initial</span>
          <input value={form.name} autoComplete="off" onChange={(event) => set({ name: event.target.value })} />
          {field('name')}
        </label>
        <label className="adm-field">
          <span>Mobile number</span>
          <input value={form.phone} inputMode="tel" autoComplete="off" onChange={(event) => set({ phone: event.target.value })} />
          {field('phone')}
        </label>
      </div>
      <label className="adm-field">
        <span>Email (optional)</span>
        <input value={form.email} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" onChange={(event) => set({ email: event.target.value })} />
        {field('email')}
      </label>
      <div className="adm-field">
        <span id="online-college-label">College</span>
        <SearchSelect
          id="online-college"
          labelId="online-college-label"
          options={COLLEGES}
          value={college.choice}
          onChange={(choice) => setCollege({ ...college, choice })}
          placeholder="Choose… (type to find it)"
          searchPlaceholder="College name or initials"
          searchLabel="Search colleges"
          emptyText={(query) => `No college matches “${query}”. Choose ${OTHER_COLLEGE} and type it.`}
          bestFirst
          searchFirst
        />
        {college.choice !== OTHER_COLLEGE && field('college')}
      </div>
      {college.choice === OTHER_COLLEGE && (
        <label className="adm-field">
          <span>Their college</span>
          <input value={college.other} maxLength={120} autoComplete="off" onChange={(event) => setCollege({ ...college, other: event.target.value })} />
          {field('college')}
        </label>
      )}
      <div className="fest-form__row">
        <label className="adm-field">
          <span>College code (if known)</span>
          <input value={form.collegeCode} maxLength={12} autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={(event) => set({ collegeCode: event.target.value })} />
          {field('collegeCode')}
        </label>
        <label className="adm-field">
          <span>Register / roll number (optional)</span>
          <input value={form.ref} maxLength={40} autoComplete="off" onChange={(event) => set({ ref: event.target.value })} />
        </label>
      </div>
      <div className="fest-form__row">
        <label className="adm-field">
          <span>Department / course (optional)</span>
          <input value={form.branch} maxLength={120} autoComplete="off" placeholder="e.g. B.Tech AI & DS" onChange={(event) => set({ branch: event.target.value })} />
        </label>
        <label className="adm-field">
          <span>Year (optional)</span>
          <select value={form.year} onChange={(event) => set({ year: event.target.value })}>
            <option value="">Choose</option>
            {YEARS.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="adm-field">
        <span>UTR of the ₹{catalog?.entryFee ?? 100} paid online (optional)</span>
        <input value={form.utr} inputMode="numeric" autoComplete="off" placeholder="12 digits" onChange={(event) => set({ utr: event.target.value })} />
        {field('utr')}
      </label>
      {events.length > 0 && (
        <fieldset className="fest-events">
          <legend>Events they chose (optional: they can also join at the venue)</legend>
          {events.map((item) => (
            <label key={item.id} className="adm-check">
              <input type="checkbox" checked={picked.includes(item.id)} onChange={() => setPicked(picked.includes(item.id) ? picked.filter((id) => id !== item.id) : [...picked, item.id])} />
              <span>{eventLabel(item)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      <button className="adm-button adm-button--primary adm-button--big" type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add and give the ID'}
      </button>
      {added.length > 0 && (
        <div role="status">
          <h3 className="adm-h3">Added now ({added.length})</h3>
          <ul className="adm-list">
            {added.map((item) => (
              <li key={item.id}>
                <strong className="adm-mono">{showId(item.id)}</strong> {item.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}



const CHUNK = 100;

export function ImportView({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const [dept, setDept, canPick] = useWorkDept();
  return (
    <main className="adm-page">
      {canPick && <DeptPicker value={dept} onChange={setDept} />}
      {!dept ? (
        <p className="adm-note">Choose the department.</p>
      ) : (
        <>
          <TypeOneIn key={`one-${dept}`} dept={dept} token={token} onSignedOut={onSignedOut} />
          <OnlineImport key={dept} dept={dept} token={token} onSignedOut={onSignedOut} />
        </>
      )}
    </main>
  );
}

function OnlineImport({ dept, token, onSignedOut }: { dept: string; token: string; onSignedOut: () => void }) {
  const { refresh } = useFest();
  const [file, setFile] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [columns, setColumns] = useState<Record<ImportField, number> | null>(null);
  const [checked, setChecked] = useState<ImportOutcome[] | null>(null);
  const [done, setDone] = useState<ImportOutcome[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    setChecked(null);
    setDone(null);
    setError('');
    if (!picked) return;
    if (!/\.csv$/i.test(picked.name)) {
      setError('Choose a .csv file. In Excel: File → Save As → CSV UTF-8.');
      return;
    }
    const rows = parseCsv(await picked.text());
    if (rows.length < 2) {
      setError('The file has no registrations under its header row.');
      return;
    }
    setFile(picked.name);
    setTable(rows);
    setColumns(guessColumns(rows[0]));
  };

  const rows = (): ImportRow[] =>
    (table ?? []).slice(1).map((cells, index) => {
      const cell = (field: ImportField) => (columns && columns[field] >= 0 ? (cells[columns[field]] ?? '').trim() : '');
      return { row: index + 2, name: cell('name'), phone: cell('phone'), email: cell('email'), college: cell('college'), collegeCode: cell('collegeCode'), branch: cell('branch'), year: cell('year'), team: cell('team'), events: cell('events'), utr: cell('utr'), ref: cell('ref') };
    });

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'check' : 'import');
    setError('');
    try {
      const all = rows();
      const outcomes: ImportOutcome[] = [];
      for (let start = 0; start < all.length; start += CHUNK) {
        outcomes.push(...(await importFest(token, { dept, rows: all.slice(start, start + CHUNK), dryRun })));
      }
      if (dryRun) setChecked(outcomes);
      else {
        setDone(outcomes);
        refresh();
      }
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure instanceof ApiFailure || failure instanceof Error ? failure.message : 'The upload failed.');
    } finally {
      setBusy('');
    }
  };

  const missing = IMPORT_FIELDS.filter((item) => item.required && (!columns || columns[item.field] < 0));
  const shown = done ?? checked;
  const count = (status: ImportOutcome['status']) => shown?.filter((item) => item.status === status).length ?? 0;
  const byRow = new Map(rows().map((item) => [item.row, item]));

  return (
    <section className="adm-card adm-pad">
      <h2 className="adm-h2">Or upload the online form’s CSV</h2>
      <p className="adm-muted">
        Export the {deptShort(dept)} registrations from the online form as a CSV file (Google Forms: Responses → Download). Each student gets a {deptShort(dept)}-5001… ID; the entry fee counts as paid online and
        event fees are paid at each venue. A college code is not needed. Uploading the same file again adds only new students.
      </p>
      <label className="adm-field">
        <span>CSV file</span>
        <input type="file" accept=".csv,text/csv" onChange={(event) => void load(event)} />
      </label>
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      {table && columns && (
        <>
          <p className="adm-muted">
            {file}: {table.length - 1} rows. Check which column holds each detail:
          </p>
          <div className="fest-columns">
            {IMPORT_FIELDS.map((item) => (
              <label key={item.field} className="adm-field">
                <span>
                  {item.label}
                  {item.required ? '' : ' (optional)'}
                </span>
                <select
                  value={columns[item.field]}
                  onChange={(event) => {
                    setColumns({ ...columns, [item.field]: Number(event.target.value) });
                    setChecked(null);
                  }}
                >
                  <option value={-1}>— none —</option>
                  {table[0].map((title, index) => (
                    <option key={index} value={index}>
                      {title || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--static fest-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  {IMPORT_FIELDS.map((item) => (
                    <th key={item.field} scope="col">
                      {item.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows()
                  .slice(0, 5)
                  .map((item) => (
                    <tr key={item.row}>
                      <td>{item.row}</td>
                      {IMPORT_FIELDS.map((field) => (
                        <td key={field.field}>{item[field.field]}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && <p className="adm-field__error">Choose the column for: {missing.map((item) => item.label).join(', ')}.</p>}
          <div className="adm-inline adm-inline--wrap">
            <button className="adm-button" type="button" disabled={busy !== '' || missing.length > 0} onClick={() => void run(true)}>
              {busy === 'check' ? 'Checking…' : 'Check the file'}
            </button>
            <button
              className="adm-button adm-button--primary"
              type="button"
              disabled={busy !== '' || !checked || count('ok') === 0 || Boolean(done)}
              onClick={() => {
                if (window.confirm(`Import ${count('ok')} new registrations into ${deptShort(dept)}?`)) void run(false);
              }}
            >
              {busy === 'import' ? 'Importing…' : checked ? `Import ${count('ok')} new registrations` : 'Import'}
            </button>
          </div>
        </>
      )}
      {shown && (
        <>
          <p className={done ? 'adm-note' : 'adm-muted'}>
            {done ? `Imported ${count('created')} registrations.` : `${count('ok')} ready to import.`} {count('duplicate')} already registered · {count('error')} with a problem.
          </p>
          {(count('error') > 0 || count('duplicate') > 0 || done) && (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--static fest-table">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Name</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {shown
                    .filter((item) => item.status !== 'ok')
                    .map((item) => (
                      <tr key={item.row}>
                        <td>{item.row}</td>
                        <td>{byRow.get(item.row)?.name}</td>
                        <td>{item.status === 'created' ? `${showId(item.id ?? '')}` : `${item.status === 'duplicate' ? 'Already registered' : 'Problem'}: ${item.message ?? ''}`}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            className="adm-button adm-button--small"
            type="button"
            onClick={() =>
              saveFile(
                `${dept}-import-${done ? 'result' : 'check'}.csv`,
                toCsv([['Row', 'Name', 'Phone', 'Result', 'Registration ID', 'Message'], ...shown.map((item) => [item.row, byRow.get(item.row)?.name ?? '', byRow.get(item.row)?.phone ?? '', item.status, item.id ?? '', item.message ?? ''])]),
                'text/csv;charset=utf-8',
              )
            }
          >
            Download this list
          </button>
        </>
      )}
    </section>
  );
}
