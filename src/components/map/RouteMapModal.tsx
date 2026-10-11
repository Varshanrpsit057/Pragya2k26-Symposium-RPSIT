import { useRef, useState } from 'react';
import { campusMap } from '../../content/campusMap';
import { events } from '../../content/events';
import { venueOf } from '../../lib/campusMap';
import { HelpDeskLine } from '../help/HelpDeskLine';
import { Modal } from '../modal/Modal';
import { CampusMap } from './CampusMap';
import { ROUTE_HASH } from './routeHash';
import './RouteMapModal.css';

/** The events whose venue is on the map, in the order the website lists them. */
const MAPPED = events.filter((event) => venueOf(campusMap, event.venue));

interface RouteMapModalProps {
  open: boolean;
  /** The event to start with (from a shared link), if any. */
  eventId: string | null;
  onClose: () => void;
}

/**
 * The Route map, from the home page: the student picks their event (or a restroom, drinking water,
 * the canteen…) and where they are, and sees the way, floor by floor. The address follows the
 * event chosen (#route-map=<event>), so the link can be shared with friends going to it.
 */
export function RouteMapModal({ open, eventId, onClose }: RouteMapModalProps) {
  const [chosen, setChosen] = useState<string | null>(eventId);
  const [opening, setOpening] = useState({ open, eventId });
  const mapRef = useRef<HTMLElement>(null);

  // Opened (again, or from another link): start from the event in the link.
  if (opening.open !== open || opening.eventId !== eventId) {
    setOpening({ open, eventId });
    if (open) setChosen(eventId);
  }
  const event = MAPPED.find((item) => item.id === chosen) ?? null;

  const choose = (id: string) => {
    setChosen(id);
    if (window.location.hash.startsWith(`#${ROUTE_HASH}`)) window.history.replaceState(null, '', `#${ROUTE_HASH}=${id}`);
    // On a phone the map is below the list: bring it into view.
    requestAnimationFrame(() => {
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      mapRef.current?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    });
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="route-map-title" className="route-modal">
      <div className="route-modal__body">
        <header className="route-modal__head">
          <h2 id="route-map-title" className="route-modal__title">
            Route map
          </h2>
          <p className="route-modal__lead">Pick your event or a place (restroom, water, canteen…) and where you are: the way is drawn for you.</p>
        </header>

        <fieldset className="route-picker">
          <legend className="route-picker__legend">Going to an event?</legend>
          {MAPPED.map((item) => (
            <label key={item.id} className={`route-picker__option${item.id === chosen ? ' is-chosen' : ''}`}>
              <input className="route-picker__input" type="radio" name="route-event" value={item.id} checked={item.id === chosen} onChange={() => choose(item.id)} />
              {item.poster && <img className="route-picker__poster" src={item.poster} alt="" width="42" height="56" loading="lazy" decoding="async" />}
              <span className="route-picker__text">
                <span className="route-picker__name">{item.name}</span>
                <span className="route-picker__where">{item.venue}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <section ref={mapRef} className="route-modal__map" aria-label={event?.venue ? `Map to ${event.venue}` : 'Campus map'}>
          <CampusMap map={campusMap} venue={event?.venue ?? null} footer={<HelpDeskLine lead="Lost? Call the help desk" />} />
        </section>
      </div>
    </Modal>
  );
}
