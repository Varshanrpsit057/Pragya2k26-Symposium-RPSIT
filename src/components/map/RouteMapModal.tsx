import { useRef, useState } from 'react';
import { campusMap } from '../../content/campusMap';
import { events } from '../../content/events';
import { venueOf } from '../../lib/campusMap';
import { HelpDeskLine } from '../help/HelpDeskLine';
import { Modal } from '../modal/Modal';
import { CampusMap } from './CampusMap';
import './RouteMapModal.css';

/** The events whose venue is on the map, in the order the website lists them. */
const MAPPED = events.filter((event) => venueOf(campusMap, event.venue));

export const ROUTE_HASH = 'route-map';

/** '#route-map' or '#route-map=viz-craft' → the event to show (or none yet); null for any other address. */
export function parseRouteHash(hash: string): { eventId: string | null } | null {
  const match = /^#route-map(?:=([a-z0-9-]+))?$/.exec(hash);
  return match ? { eventId: match[1] ?? null } : null;
}

interface RouteMapModalProps {
  open: boolean;
  /** The event to start with (from a shared link), if any. */
  eventId: string | null;
  onClose: () => void;
}

/**
 * The Route map, from the home page: the student picks their event and sees the way from the
 * main gate to its venue, floor by floor. The address follows the choice (#route-map=<event>),
 * so the link can be shared with friends going to the same event.
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
          <p className="route-modal__lead">Choose your event to see the way from the main gate to its venue.</p>
        </header>

        <fieldset className="route-picker">
          <legend className="route-picker__legend">Your event</legend>
          {MAPPED.map((item) => (
            <label key={item.id} className={`route-picker__option${item.id === chosen ? ' is-chosen' : ''}`}>
              <input className="route-picker__input" type="radio" name="route-event" value={item.id} checked={item.id === chosen} onChange={() => choose(item.id)} />
              {item.poster && <img className="route-picker__poster" src={item.poster} alt="" width="42" height="56" loading="lazy" decoding="async" />}
              <span className="route-picker__text">
                <span className="route-picker__name">{item.name}</span>
                <span className="route-picker__where">
                  {item.venue}
                  {item.schedule && ` · ${item.schedule}`}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {event?.venue ? (
          <section ref={mapRef} className="route-modal__map" aria-label={`Map to ${event.venue}`}>
            <CampusMap key={event.id} map={campusMap} venue={event.venue} footer={<HelpDeskLine lead="Lost? Call the help desk" />} />
          </section>
        ) : (
          <p className="route-modal__hint">Pick an event above: its venue lights up on the map, with the way there.</p>
        )}
      </div>
    </Modal>
  );
}
