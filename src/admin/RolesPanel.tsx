import { CREATABLE_ROLES, CURRENT_PERMISSIONS, DEPARTMENT_ROLES, PERMISSION_LABELS, ROLE_INFO, ROLE_PERMISSIONS, type SessionInfo } from '../lib/staff';

/** What each role may do, from the same list the server enforces (src/lib/staff.ts). */
export function RolesPanel({ session }: { session: SessionInfo }) {
  const roles = CREATABLE_ROLES.includes(session.role) ? CREATABLE_ROLES : [...CREATABLE_ROLES, session.role];
  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <h2 className="adm-h2">Roles and permissions</h2>
        <p className="adm-muted">
          Every request is checked on the server against this list. Department roles see and work on their own department only; event coordinators on their own events. You are signed in as{' '}
          <strong>{ROLE_INFO[session.role]?.label ?? session.role}</strong>
          {session.department && <> for {session.department}</>}
          {session.role === 'COORDINATOR' && session.eventIds.length > 0 && <> ({session.eventIds.join(', ')})</>}.
        </p>
        <div className="adm-roles">
          {roles.map((role) => (
            <article key={role} className={`adm-role${role === session.role ? ' is-mine' : ''}`}>
              <h3 className="adm-role__name">{ROLE_INFO[role]?.label ?? role}</h3>
              <p className="adm-muted">{ROLE_INFO[role]?.summary}</p>
              <ul className="adm-role__list">
                {CURRENT_PERMISSIONS.map((permission) => {
                  const allowed = (ROLE_PERMISSIONS[role] ?? []).includes(permission);
                  return (
                    <li key={permission} className={allowed ? 'is-allowed' : 'is-denied'}>
                      <span aria-hidden="true">{allowed ? '✓' : '–'}</span>
                      <span className="sr-only">{allowed ? 'Allowed: ' : 'Not allowed: '}</span>
                      {PERMISSION_LABELS[permission]}
                      {allowed && role === 'COORDINATOR' && permission === 'fest.event' ? ' (assigned events only)' : ''}
                      {allowed && DEPARTMENT_ROLES.includes(role) && permission === 'fest.view' ? ' (own department)' : ''}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
        <h3 className="adm-h3">Rules that apply to everyone</h3>
        <ul className="adm-rules">
          <li>Students register on their phones under their department: IDs carry the department (CSE-2001), and one phone number is registered once per department.</li>
          <li>The ₹100 entry fee is paid by UPI on the phone (the department’s desk checks the UTR) or at the desk; each event’s fee is taken by its coordinators at the venue.</li>
          <li>Money counts as received only when the staff member confirms it: cash in hand, or the UPI payment seen with its transaction ID.</li>
          <li>Attendance can be marked only after the entry fee is paid, the student is registered for the event and its fee is taken.</li>
          <li>Once a coordinator submits an event’s results, the event is locked; only the overall coordinator (or the web assist team) can reopen it.</li>
          <li>Every registration, payment, attendance mark and result records who did it and when.</li>
        </ul>
      </section>
    </main>
  );
}
