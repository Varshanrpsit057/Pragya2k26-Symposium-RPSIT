import { PERMISSION_LABELS, ROLE_INFO, ROLE_PERMISSIONS, STAFF_ROLES, type Permission, type SessionInfo } from '../lib/staff';

const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

/** What each role may do, from the same list the server enforces (src/lib/staff.ts). */
export function RolesPanel({ session }: { session: SessionInfo }) {
  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <h2 className="adm-h2">Roles and permissions</h2>
        <p className="adm-muted">
          Every request is checked on the server against this list. Coordinators work only on the events assigned to their account. You are
          signed in as <strong>{ROLE_INFO[session.role].label}</strong>
          {session.role === 'COORDINATOR' && session.eventIds.length > 0 && <> for {session.eventIds.join(', ')}</>}.
        </p>
        <div className="adm-roles">
          {STAFF_ROLES.map((role) => (
            <article key={role} className={`adm-role${role === session.role ? ' is-mine' : ''}`}>
              <h3 className="adm-role__name">{ROLE_INFO[role].label}</h3>
              <p className="adm-muted">{ROLE_INFO[role].summary}</p>
              <ul className="adm-role__list">
                {ALL_PERMISSIONS.map((permission) => {
                  const allowed = ROLE_PERMISSIONS[role].includes(permission);
                  return (
                    <li key={permission} className={allowed ? 'is-allowed' : 'is-denied'}>
                      <span aria-hidden="true">{allowed ? '✓' : '–'}</span>
                      <span className="sr-only">{allowed ? 'Allowed: ' : 'Not allowed: '}</span>
                      {PERMISSION_LABELS[permission]}
                      {allowed && role === 'COORDINATOR' ? ' (assigned events only)' : ''}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
        <h3 className="adm-h3">Rules that apply to everyone</h3>
        <ul className="adm-rules">
          <li>Registration status, the ₹100 gate pass and each ₹50 event fee are recorded separately.</li>
          <li>Money counts as received only when the staff member confirms it: cash in hand, or UPI seen credited. A QR scan, screenshot or transaction ID alone is never proof.</li>
          <li>Attendance can be marked only after the gate pass is verified, the participant is registered for the event and its fee is recorded.</li>
          <li>Once a coordinator submits an event&apos;s results, the event is locked; only an admin can authorise a correction.</li>
          <li>Every payment, attendance mark and result records who did it and when.</li>
        </ul>
      </section>
    </main>
  );
}
