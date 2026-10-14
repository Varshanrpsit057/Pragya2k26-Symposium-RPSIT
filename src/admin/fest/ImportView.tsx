/**
 * Department admins (and the web assist team): bring in the online registrations from the
 * online form's CSV before the event day.
 */
import { useState, type ChangeEvent } from 'react';
import { deptShort, guessColumns, IMPORT_FIELDS, parseCsv, showId, toCsv, type ImportField } from '../../lib/fest';
import { ApiFailure, SignedOut } from '../adminApi';
import { saveFile } from '../ui';
import { DeptPicker, useWorkDept } from './DeskView';
import { importFest, type ImportOutcome, type ImportRow } from './festApi';
import { useFest } from './FestData';

const CHUNK = 100;

export function ImportView({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const [dept, setDept, canPick] = useWorkDept();
  return (
    <main className="adm-page">
      {canPick && <DeptPicker value={dept} onChange={setDept} />}
      {!dept ? <p className="adm-note">Choose the department.</p> : <OnlineImport key={dept} dept={dept} token={token} onSignedOut={onSignedOut} />}
    </main>
  );
}

function OnlineImport({ dept, token, onSignedOut }: { dept: string; token: string; onSignedOut: () => void }) {
  const { refresh } = useFest();
  const [file, setFile] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [columns, setColumns] = useState<Record<ImportField, number> | null>(null);
  const [feesPaid, setFeesPaid] = useState(false);
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
      return { row: index + 2, name: cell('name'), phone: cell('phone'), email: cell('email'), college: cell('college'), collegeCode: cell('collegeCode'), branch: cell('branch'), year: cell('year'), team: cell('team'), events: cell('events'), ref: cell('ref') };
    });

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'check' : 'import');
    setError('');
    try {
      const all = rows();
      const outcomes: ImportOutcome[] = [];
      for (let start = 0; start < all.length; start += CHUNK) {
        outcomes.push(...(await importFest(token, { dept, rows: all.slice(start, start + CHUNK), dryRun, eventFeesPaid: feesPaid })));
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
      <h2 className="adm-h2">Online registrations for {deptShort(dept)}</h2>
      <p className="adm-muted">
        Export the {deptShort(dept)} registrations from the online form as a CSV file and upload it here before the event day. Each student gets a {deptShort(dept)}-5001… ID and counts as paid. Uploading the same file
        again adds only new students.
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
          <label className="adm-check">
            <input type="checkbox" checked={feesPaid} onChange={(event) => setFeesPaid(event.target.checked)} />
            <span>The event fees were also paid online (otherwise each event’s fee is taken at its venue)</span>
          </label>
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
