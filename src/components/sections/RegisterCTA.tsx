import { site } from '../../content/site';
import { useRegistrationPhase } from '../../hooks/useRegistrationPhase';
import { useSchedule } from '../../lib/liveSchedule';
import { onsiteClosingTime } from '../../lib/schedule';
import { DriftWall } from '../background/DriftWall';
import { STUDENT_PAGE } from '../../lib/student';
import { RegisterButton } from '../ui/RegisterButton';
import './RegisterCTA.css';

/**
 * Open online until registration.closesAt, then on-site on the event day, then closed.
 * Its own component, so the once-a-second clock re-renders only this badge.
 */
function RegistrationStatus() {
  const phase = useRegistrationPhase();
  const closes = onsiteClosingTime(useSchedule());
  if (phase === 'closed') return <span className="register__status is-closed">Registration closed</span>;
  if (phase === 'onsite') return <span className="register__status is-open">On-site registration open today until {closes}</span>;
  if (phase === 'between') return <span className="register__status">On-site registration on {site.dates ?? 'the event day'}</span>;
  return site.registration.endpoint ? (
    <span className="register__status is-open">Registration is open</span>
  ) : (
    <span className="register__status">Registration opens soon</span>
  );
}

/** How to register right now: online with a deadline, or at the desk on the day. */
function RegistrationLead() {
  const phase = useRegistrationPhase();
  const closes = onsiteClosingTime(useSchedule());
  const { deadline, onsite } = site.registration;
  if (phase === 'closed') {
    return <p className="register__lead">Registration for {site.name} {site.year} has closed. Thank you for your interest.</p>;
  }
  if (phase === 'onsite' || phase === 'between') {
    return (
      <>
        <p className="register__lead">
          Online registration has closed. Register on-site at {onsite.desk}.
          {phase === 'onsite' && ' Already registered? Use Student login with your Registration ID and phone number to get your pass and your event timings.'}
        </p>
        <p className="register__deadline">{phase === 'onsite' ? `On-site registration is open today, until ${closes}` : `On-site registration: ${site.dates ?? 'the event day'}, until ${closes}`}</p>
      </>
    );
  }
  return (
    <>
      <p className="register__lead">Register online for your gate pass, then sign up for your events at the venue.</p>
      {deadline && <p className="register__deadline">Register by {deadline}</p>}
      <p className="register__lead">
        Already registered? Once approved, download your pass from <a href={STUDENT_PAGE}>Student login</a> with your Registration ID and phone number.
      </p>
    </>
  );
}

export function RegisterCTA() {
  const { note, gatePassFee, eventFee } = site.registration;

  return (
    <section id="register" className="section register" aria-labelledby="register-title">
      <DriftWall />
      <div className="register__veil" aria-hidden="true" />

      <div className="container register__inner">
        <div className="register__panel" data-reveal>
          <RegistrationStatus />

          <h2 id="register-title" className="section-title register__title">
            Join {site.name} {site.year}
          </h2>

          <RegistrationLead />
          {note && <p className="register__note">{note}</p>}

          <div className="register__actions">
            <RegisterButton size="lg" magnetic />
          </div>

          <aside className="register__notice" aria-labelledby="register-notice-title">
            <h3 id="register-notice-title" className="register__notice-title">
              Important notice
            </h3>
            <ul className="register__notice-list">
              <li>
                <span>Registration amount</span>
                <strong>₹{gatePassFee} per person</strong>
              </li>
              <li className="register__notice-aside">This amount is the gate pass fee.</li>
              <li>
                <span>Event registration</span>
                <strong>On-site payment only</strong>
              </li>
              <li>
                <span>Event registration fee</span>
                <strong>₹{eventFee} per event</strong>
              </li>
            </ul>
          </aside>
        </div>
      </div>
    </section>
  );
}
