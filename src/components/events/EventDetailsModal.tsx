import { useState } from 'react';
import { DAY_INSTRUCTIONS, eventInfo } from '../../content/eventInfo';
import { site } from '../../content/site';
import type { SymposiumEvent } from '../../content/types';
import { useEventDay } from '../../hooks/useEventDay';
import { rupees } from '../../lib/registration';
import { STUDENT_PAGE } from '../../lib/student';
import { campusMap } from '../../content/campusMap';
import { venueOf } from '../../lib/campusMap';
import { HelpDeskLine } from '../help/HelpDeskLine';
import { CampusMap } from '../map/CampusMap';
import { Modal } from '../modal/Modal';
import { SpecularButton } from '../ui/SpecularButton';
import './EventDetailsModal.css';

interface EventDetailsModalProps {
  event: SymposiumEvent | null;
  onClose: () => void;
  onRegister: (event: SymposiumEvent) => void;
}

/** '1st prize: ₹1,000' → ['1st prize', '₹1,000']; anything else stays a note. */
const prizeParts = (prize: string) => {
  const match = /^(.+?):\s*(.+)$/.exec(prize);
  return match ? { place: match[1], amount: match[2] } : null;
};

/** How many may take part, in a few words: 'Individual', 'Individual or team of up to 2'. */
function participation(event: SymposiumEvent): string {
  if (!event.teams) return 'Individual';
  return event.teams.maxSize ? `Individual or team of up to ${event.teams.maxSize}` : 'Individual or team';
}

/**
 * The See More window: one event, each fact once. Who runs it first, then when, where (with
 * the way there) and how to take part, then the rounds, how it works, rules, judging and
 * prizes, and finally what every participant needs on the day.
 */
export function EventDetailsModal({ event, onClose, onRegister }: EventDetailsModalProps) {
  const info = event ? eventInfo[event.id] : undefined;
  const coordinators = event?.coordinators ?? [];
  const confirmed = coordinators.length > 0;
  const eventDay = useEventDay();
  const prizes = event?.prizes ?? [];
  const placePrizes = prizes.map(prizeParts).filter((prize) => prize !== null);
  const prizeNotes = prizes.filter((prize) => !prizeParts(prize));
  // The map opens inside this window, under the facts, for this event only.
  const [mapFor, setMapFor] = useState<string | null>(null);
  const showMap = Boolean(event && mapFor === event.id);

  return (
    <Modal open={Boolean(event)} onClose={onClose} labelledBy="event-details-title" className="event-modal">
      {event && (
        <article className="event-details" data-category={event.category}>
          <header className="event-details__head">
            <h2 id="event-details-title" className="event-details__name">
              {event.name}
            </h2>
            {event.subtitle && <p className="event-details__subtitle">{event.subtitle}</p>}
            {confirmed && (
              <p className="event-details__coordinators" aria-label="Event coordinators">
                <span className="event-details__label">Coordinators</span>
                {coordinators.map((person) => (
                  <span key={person.name} className="event-details__chip">
                    {person.name}
                  </span>
                ))}
              </p>
            )}
            <p className="event-details__description">{event.description}</p>
          </header>

          <dl className="event-details__facts">
            {event.schedule && (
              <div>
                <dt>When</dt>
                <dd>
                  {site.dates && <span className="event-details__muted">{site.dates} · </span>}
                  {event.schedule}
                </dd>
              </div>
            )}
            {event.venue && (
              <div className="event-details__venue">
                <dt>Where</dt>
                <dd>{event.venue}</dd>
                <RouteMap venue={event.venue} url={event.routeMap ?? null} expanded={showMap} onToggle={() => setMapFor(showMap ? null : event.id)} />
              </div>
            )}
            <div>
              <dt>Taking part</dt>
              <dd>{participation(event)}</dd>
            </div>
            <div>
              <dt>Event fee</dt>
              <dd>{rupees(site.registration.eventFee)} at the venue</dd>
            </div>
          </dl>

          {showMap && event.venue && (
            <section className="event-details__map" aria-label={`Map to ${event.venue}`}>
              <CampusMap map={campusMap} venue={event.venue} footer={<HelpDeskLine lead="Lost? Call the help desk" />} />
            </section>
          )}

          {event.chiefGuest && (
            <p className="event-details__guest">
              <span className="event-details__label">Chief guest &amp; jury</span>
              {event.chiefGuest.replace(/\s*\(chief guest and jury\)$/i, '')}
            </p>
          )}

          {info && (
            <section className="event-details__block" aria-labelledby="event-details-rounds">
              <h3 id="event-details-rounds">Rounds</h3>
              <ol className="event-details__rounds">
                {info.rounds.map((round) => (
                  <li key={round.name}>
                    <strong>{round.name}</strong>
                    <span>{round.detail}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {info && (
            <div className="event-details__columns">
              <DetailList id="event-details-how" title="How it works" items={info.procedure} />
              {info.rules.length > 0 && <DetailList id="event-details-rules" title="Rules" items={info.rules} />}
            </div>
          )}

          {info && (
            <section className="event-details__block" aria-labelledby="event-details-judging">
              <h3 id="event-details-judging">Judged on</h3>
              <ul className="event-details__tags">
                {info.judging.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </section>
          )}

          {prizes.length > 0 && (
            <section className="event-details__block" aria-labelledby="event-details-prizes">
              <h3 id="event-details-prizes">Prizes</h3>
              {placePrizes.length > 0 && (
                <ul className="event-details__prizes">
                  {placePrizes.map((prize) => (
                    <li key={prize.place}>
                      <span>{prize.place}</span>
                      <strong>{prize.amount}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {prizeNotes.map((note) => (
                <p key={note} className="event-details__muted">
                  {note}
                </p>
              ))}
            </section>
          )}

          <aside className="event-details__notice" aria-labelledby="event-details-notice">
            <h3 id="event-details-notice">Please note</h3>
            <ul>
              <li>The judges' decision is final. No arguments about the winners will be entertained.</li>
              <li>The rules and regulations given at the venue are final; the rules on this website are subject to change.</li>
            </ul>
          </aside>

          <section className="event-details__day" aria-labelledby="event-details-day">
            <h3 id="event-details-day">On the day</h3>
            <ul>
              {DAY_INSTRUCTIONS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <HelpDeskLine lead="Any help on the day? Call the help desk" />
            {site.contacts.length > 0 && (
              <p className="event-details__muted">
                Coordinator:{' '}
                {site.contacts.map((person) => (
                  <span key={person.name}>
                    {person.name}
                    {person.phone && (
                      <>
                        {' '}
                        <a href={`tel:${person.phone.replace(/[^\d+]/g, '')}`}>{person.phone}</a>
                      </>
                    )}
                  </span>
                ))}
              </p>
            )}
          </section>

          <footer className="event-details__foot">
            {!confirmed && <p className="event-details__provisional">Details are provisional; the coordinators will confirm the final rules.</p>}
            <div className="event-details__actions">
              <SpecularButton variant="ghost" onClick={onClose}>
                Close
              </SpecularButton>
              {eventDay ? (
                <SpecularButton href={STUDENT_PAGE}>Student login</SpecularButton>
              ) : (
                <SpecularButton aria-haspopup="dialog" onClick={() => onRegister(event)}>
                  Register Now
                </SpecularButton>
              )}
            </div>
          </footer>
        </article>
      )}
    </Modal>
  );
}

/**
 * The way to the venue. With a link set (eventCatalog.ts, routeMap) it opens it; until then
 * the button says the map is coming, so the place for it is already there.
 */
/** A map link when one is set, otherwise the campus map (in this window) with the venue lit up. */
function RouteMap({ venue, url, expanded, onToggle }: { venue: string; url: string | null; expanded: boolean; onToggle: () => void }) {
  const [asked, setAsked] = useState(false);
  if (url) {
    return (
      <a className="event-details__route" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Route map to ${venue} (opens in a new tab)`}>
        <RouteIcon />
        Route map
      </a>
    );
  }
  if (venueOf(campusMap, venue)) {
    return (
      <button type="button" className="event-details__route" aria-expanded={expanded} onClick={onToggle}>
        <RouteIcon />
        {expanded ? 'Hide map' : 'Route map'}
      </button>
    );
  }
  return (
    <>
      <button type="button" className="event-details__route" aria-expanded={asked} onClick={() => setAsked(!asked)}>
        <RouteIcon />
        Route map
      </button>
      {asked && (
        <p className="event-details__route-note" role="status">
          The route map to {venue} is coming soon. On the day, volunteers at the gate will show you the way.
        </p>
      )}
    </>
  );
}

function RouteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z" />
        <circle cx="12" cy="10.5" r="2.2" />
      </g>
    </svg>
  );
}

function DetailList({ id, title, items }: { id: string; title: string; items: string[] }) {
  return (
    <section className="event-details__block" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <ul className="event-details__list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
