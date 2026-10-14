/**
 * Department logins (web assist team): one click makes every login a department needs — its
 * admin, its two desks and a coordinator for each of its events — with a new password each, and
 * saves them in a Word file: a table per department with each role, name, username, password and
 * the link to sign in. The non-technical events' shared view-only login can be made with them.
 *
 * Usernames are fixed (cse-admin, cse-desk1, cse-desk2, the event's ID for its coordinator,
 * nontech), so running it again gives the same accounts new passwords: the Word file always holds
 * logins that work. Passwords exist only on this page until it is closed: only a scrambled copy is
 * kept on the server.
 */
import { useState } from 'react';
import { buildDocx, DOCX_TYPE, type DocTable } from '../lib/docx';
import { DESKS, deptShort, eventLabel, type FestCatalog } from '../lib/fest';
import { formatIst } from '../lib/countdown';
import { ROLE_INFO, type StaffRole } from '../lib/staff';
import { ApiFailure, SignedOut, createStaff, listStaff, updateStaff } from './adminApi';
import { useFestCatalog } from './fest/FestData';
import { generatePassword } from './StaffPanel';
import { ErrorNote, messageOf, saveFile } from './ui';

/** The non-technical events' login, chosen like a department. */
export const NONTECH = 'NONTECH';

interface Slot {
  section: string;
  role: StaffRole;
  /** What the person does, for the table ("Desk 1", "Hackathon"). */
  job: string;
  username: string;
  displayName: string;
  department: string | null;
  deskNumber: number | null;
  eventIds: string[];
  link: string;
}

export interface MadeLogin extends Slot {
  password: string;
  outcome: 'created' | 'renewed' | 'failed';
  error?: string;
}

/** A display name the server accepts: letters, digits and . ' ( ) & - only, at most 60. */
const cleanName = (value: string) =>
  value
    .replace(/[^\p{L}\p{M}\p{N} .'()&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
/** A username: lower-case, at most 32, no dash at the end. */
const cleanUser = (value: string) => value.toLowerCase().slice(0, 32).replace(/[-._]+$/, '');

/** Every login a department needs: its admin, its desks, a coordinator per open event. */
export function departmentSlots(catalog: FestCatalog, code: string, origin: string): Slot[] {
  const short = deptShort(code);
  const page = `${origin}/landing/${code.toLowerCase()}/admin/`;
  const prefix = code.toLowerCase();
  return [
    { section: code, role: 'DEPT_ADMIN', job: 'Department admin', username: `${prefix}-admin`, displayName: cleanName(`${short} department admin`), department: code, deskNumber: null, eventIds: [], link: page },
    ...Array.from({ length: DESKS }, (_, index): Slot => ({
      section: code,
      role: 'DESK',
      job: `Registration desk ${index + 1}`,
      username: `${prefix}-desk${index + 1}`,
      displayName: cleanName(`${short} desk ${index + 1}`),
      department: code,
      deskNumber: index + 1,
      eventIds: [],
      link: page,
    })),
    ...catalog.events
      .filter((event) => event.dept === code && event.active)
      .map(
        (event): Slot => ({
          section: code,
          role: 'COORDINATOR',
          job: `Coordinator: ${eventLabel(event)}`,
          username: cleanUser(event.id),
          displayName: cleanName(`${event.name} (${short})`) || cleanName(`${short} event coordinator`),
          department: code,
          deskNumber: null,
          eventIds: [event.id],
          link: `${page}?event=${encodeURIComponent(event.id)}`,
        }),
      ),
  ];
}

export const nontechSlot = (origin: string): Slot => ({
  section: NONTECH,
  role: 'NONTECH',
  job: 'Non-technical events: gate pass check (view only)',
  username: 'nontech',
  displayName: 'Non-technical events',
  department: null,
  deskNumber: null,
  eventIds: [],
  link: `${origin}/landing/admin/`,
});

/** The Word file: a table per department (and one for the non-technical events). */
export function loginsDocument(catalog: FestCatalog, made: MadeLogin[], by: string) {
  const sections = [...new Set(made.map((item) => item.section))];
  const tables: DocTable[] = sections.map((section, index) => {
    const department = catalog.departments.find((item) => item.code === section);
    const rows = made.filter((item) => item.section === section && item.outcome !== 'failed');
    return {
      heading: section === NONTECH ? 'Non-technical events (view only)' : `${deptShort(section)} · ${department?.name ?? section}`,
      note:
        section === NONTECH
          ? 'One shared login: it shows every student’s ID, name and whether their entry fee is paid. Nothing can be changed with it.'
          : 'Sign in on the department’s page (the link). Each coordinator’s link opens their event directly. Keep this page private: hand each person only their own row.',
      newPage: index > 0,
      columns: [
        { title: 'Role', width: 3900 },
        { title: 'Name', width: 2700 },
        { title: 'Username', width: 2500, mono: true },
        { title: 'Password', width: 2500, mono: true },
        { title: 'Sign-in link', width: 3798 },
      ],
      rows: rows.map((item) => [item.job, item.displayName, item.username, item.password, { text: item.link.replace(/^https?:\/\//, ''), href: item.link }]),
    };
  });
  return buildDocx({
    title: 'INFINITE TECHFEST’26 · Staff logins',
    subtitle: `Made by ${by} on ${formatIst(Date.now())}. Earlier passwords of these accounts no longer work.`,
    sections: tables,
    landscape: true,
  });
}

export function DepartmentLogins({ token, by, made, onSignedOut, onMade }: { token: string; by: string; made: MadeLogin[] | null; onSignedOut: () => void; onMade: (made: MadeLogin[]) => void }) {
  const catalog = useFestCatalog();
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<unknown>(null);
  const origin = window.location.origin;
  const choices = [...catalog.departments.map((dept) => dept.code), NONTECH];
  const slots = chosen.flatMap((code) => (code === NONTECH ? [nontechSlot(origin)] : departmentSlots(catalog, code, origin)));
  const toggle = (code: string) => setChosen((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  const fileName = () => `techfest-logins-${chosen.map((code) => (code === NONTECH ? 'nontech' : code.toLowerCase())).join('-')}.docx`;
  const save = (list: MadeLogin[]) => saveFile(fileName(), loginsDocument(catalog, list, by), DOCX_TYPE);

  const run = async () => {
    if (!slots.length) return;
    const names = chosen.map((code) => (code === NONTECH ? 'the non-technical events' : deptShort(code))).join(', ');
    if (!window.confirm(`Make ${slots.length} logins for ${names}?\n\nAccounts with these usernames that already exist get a new password: anyone signed in with them is signed out and must use the new one.`)) return;
    setBusy(true);
    setError(null);
    const done: MadeLogin[] = [];
    try {
      const existing = new Set((await listStaff(token)).map((account) => account.username));
      for (const [index, slot] of slots.entries()) {
        setProgress(`${index + 1} of ${slots.length}: ${slot.username}`);
        const password = generatePassword();
        const fields = { displayName: slot.displayName, role: slot.role, department: slot.department, deskNumber: slot.deskNumber, eventIds: slot.eventIds, password };
        try {
          if (existing.has(slot.username)) await updateStaff(token, slot.username, { ...fields, active: true });
          else await createStaff(token, { username: slot.username, ...fields });
          done.push({ ...slot, password, outcome: existing.has(slot.username) ? 'renewed' : 'created' });
        } catch (failure) {
          if (failure instanceof SignedOut) throw failure;
          done.push({ ...slot, password: '', outcome: 'failed', error: failure instanceof ApiFailure ? failure.message : messageOf(failure) });
        }
      }
    } catch (failure) {
      if (failure instanceof SignedOut) {
        onSignedOut();
        return;
      }
      setError(failure);
    } finally {
      setBusy(false);
      setProgress('');
    }
    onMade(done);
    // Saved at once: the passwords are not shown again once this page is closed.
    if (done.some((item) => item.outcome !== 'failed')) save(done);
  };

  const failed = made?.filter((item) => item.outcome === 'failed') ?? [];
  return (
    <main className="adm-page">
      <section className="adm-card adm-pad" aria-label="Department logins">
        <h2 className="adm-h2">Department logins</h2>
        <p className="adm-muted">
          Choose the departments: each gets its admin ({'{code}'}-admin), its two desks ({'{code}'}-desk1, -desk2) and a coordinator for each open event, each with a new password. The Word file
          with every login and its sign-in link downloads when they are made. Accounts with these usernames that exist get a new password.
        </p>
        <div className="fest-chips" role="group" aria-label="Departments">
          {choices.map((code) => (
            <button key={code} type="button" className={`fest-chip-button${chosen.includes(code) ? ' is-on' : ''}`} aria-pressed={chosen.includes(code)} disabled={busy} onClick={() => toggle(code)}>
              {code === NONTECH ? 'Non-technical events (view only)' : deptShort(code)}
            </button>
          ))}
          <button type="button" className="adm-button adm-button--small" disabled={busy} onClick={() => setChosen(chosen.length === choices.length ? [] : choices)}>
            {chosen.length === choices.length ? 'Clear' : 'All'}
          </button>
        </div>
        <span className="adm-inline adm-inline--wrap">
          <button className="adm-button adm-button--primary" type="button" disabled={busy || !slots.length} onClick={() => void run()}>
            {busy ? 'Making the logins…' : slots.length ? `Make ${slots.length} logins and download the Word file` : 'Choose a department'}
          </button>
          {busy && <span className="adm-muted">{progress}</span>}
        </span>
        <ErrorNote error={error} />
      </section>

      {made && (
        <section className="adm-card adm-pad" aria-label="Logins made">
          <div className="adm-toolbar">
            <h2 className="adm-h2">Logins made ({made.length - failed.length})</h2>
            <button className="adm-button adm-button--primary" type="button" disabled={made.length === failed.length} onClick={() => save(made)}>
              Download the Word file again
            </button>
          </div>
          <p className="adm-note">The passwords are shown only on this page: keep the Word file safe. Closing or reloading the page forgets them (make the logins again for new ones).</p>
          {failed.length > 0 && (
            <p className="adm-error" role="alert">
              {failed.length} could not be made: {failed.map((item) => `${item.username} (${item.error})`).join('; ')}
            </p>
          )}
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--static">
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col">Role</th>
                  <th scope="col">Username</th>
                  <th scope="col">Password</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {made.map((item) => (
                  <tr key={item.username}>
                    <td>{item.section === NONTECH ? 'Non-technical' : deptShort(item.section)}</td>
                    <td>
                      {item.job}
                      <span className="adm-muted"> · {ROLE_INFO[item.role].label}</span>
                    </td>
                    <td className="adm-mono">{item.username}</td>
                    <td className="adm-mono">{item.password || '—'}</td>
                    <td>{item.outcome === 'created' ? 'New' : item.outcome === 'renewed' ? 'New password' : 'Failed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
