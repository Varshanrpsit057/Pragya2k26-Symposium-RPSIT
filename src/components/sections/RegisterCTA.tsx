import { site } from '../../content/site';
import { useNow } from '../../hooks/useNow';
import { isRegistrationClosed } from '../../lib/registration';
import { DriftWall } from '../background/DriftWall';
import { RegisterButton } from '../ui/RegisterButton';
import './RegisterCTA.css';

/**
 * Open once the form is connected to the sheet, closed after registration.closesAt.
 * Its own component, so the once-a-second clock re-renders only this badge.
 */
function RegistrationStatus() {
  const { endpoint, closesAt } = site.registration;
  const now = useNow();
  if (now !== null && isRegistrationClosed(closesAt, now)) {
    return <span className="register__status is-closed">Registration closed</span>;
  }
  return endpoint ? (
    <span className="register__status is-open">Registration is open</span>
  ) : (
    <span className="register__status">Registration opens soon</span>
  );
}

export function RegisterCTA() {
  const { deadline, note, gatePassFee, eventFee } = site.registration;

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

          <p className="register__lead">
            Register online for your gate pass, then sign up for your events at the venue.
          </p>

          {deadline && <p className="register__deadline">Register by {deadline}</p>}
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
