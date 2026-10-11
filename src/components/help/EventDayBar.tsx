import { site } from '../../content/site';
import { ContactIcon } from '../icons/ContactIcon';
import { telHref, whatsappHref } from './HelpDeskLine';
import './EventDayBar.css';

/**
 * On the event day, help is always one tap away: a slim bar at the bottom of the screen with
 * the help desk's number (call or WhatsApp) and the route map. Shown only on the event day.
 */
export function EventDayBar() {
  const [line] = site.helpDesk.phones;
  return (
    <nav className="event-bar" aria-label="Help today">
      {line && (
        <>
          <a className="event-bar__button event-bar__button--call" href={telHref(line.phone)}>
            <ContactIcon name="phone" size={18} />
            <span className="event-bar__long">
              Call the help desk <span className="event-bar__number">{line.phone}</span>
            </span>
            <span className="event-bar__short">Help desk</span>
          </a>
          <a className="event-bar__button" href={whatsappHref(line.phone)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp the help desk on ${line.phone}`}>
            WhatsApp
          </a>
        </>
      )}
      <a className="event-bar__button" href="#route-map" aria-haspopup="dialog">
        <ContactIcon name="pin" size={18} />
        Route map
      </a>
    </nav>
  );
}
