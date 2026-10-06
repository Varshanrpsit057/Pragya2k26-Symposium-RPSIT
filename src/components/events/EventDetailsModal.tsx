import { categoryLabels } from '../../content/events';
import { eventInfo } from '../../content/eventInfo';
import type { SymposiumEvent } from '../../content/types';
import { Modal } from '../modal/Modal';
import { SpecularButton } from '../ui/SpecularButton';
import './EventDetailsModal.css';

interface EventDetailsModalProps {
  event: SymposiumEvent | null;
  onClose: () => void;
  onRegister: (event: SymposiumEvent) => void;
}

/** The See More window: everything about one event, with a way to register. */
export function EventDetailsModal({ event, onClose, onRegister }: EventDetailsModalProps) {
  const info = event ? eventInfo[event.id] : undefined;
  // Confirmed details set on the event itself win over the placeholder ones.
  const team = event?.teamSize ?? info?.team;
  const rules = event?.rules ?? info?.rules ?? [];

  return (
    <Modal open={Boolean(event)} onClose={onClose} labelledBy="event-details-title" className="event-modal">
      {event && (
        <article className="event-details" data-category={event.category}>
          <header className="event-details__head">
            {event.poster && (
              <img className="event-details__poster" src={event.poster} alt="" width={150} height={200} decoding="async" />
            )}
            <div className="event-details__intro">
              <span className="event-details__category">{categoryLabels[event.category]} event</span>
              <h2 id="event-details-title" className="event-details__name">
                {event.name}
              </h2>
              {event.subtitle && <p className="event-details__subtitle">{event.subtitle}</p>}
              <p className="event-details__description">{event.description}</p>
            </div>
          </header>

          {info && (
            <dl className="event-details__facts">
              <div>
                <dt>Event type</dt>
                <dd>{info.type}</dd>
              </div>
              <div>
                <dt>Participants</dt>
                <dd>{team}</dd>
              </div>
              <div>
                <dt>Rounds</dt>
                <dd>{info.rounds.length}</dd>
              </div>
              {event.venue && (
                <div>
                  <dt>Venue</dt>
                  <dd>{event.venue}</dd>
                </div>
              )}
              {event.schedule && (
                <div>
                  <dt>Schedule</dt>
                  <dd>{event.schedule}</dd>
                </div>
              )}
            </dl>
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

          <div className="event-details__columns">
            {info && <DetailList id="event-details-procedure" title="Event procedure" items={info.procedure} ordered />}
            {rules.length > 0 && <DetailList id="event-details-rules" title="Rules" items={rules} />}
            {info && <DetailList id="event-details-judging" title="Judging criteria" items={info.judging} />}
            {info && <DetailList id="event-details-instructions" title="Important instructions" items={info.instructions} />}
          </div>

          {event.coordinators && event.coordinators.length > 0 && (
            <section className="event-details__block" aria-labelledby="event-details-coordinators">
              <h3 id="event-details-coordinators">Coordinators</h3>
              <ul className="event-details__people">
                {event.coordinators.map((person) => (
                  <li key={`${person.name}-${person.phone ?? person.email ?? ''}`}>
                    <span>{person.name}</span>
                    {person.phone && <a href={`tel:${person.phone.replace(/\s+/g, '')}`}>{person.phone}</a>}
                    {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="event-details__foot">
            <p className="event-details__provisional">
              Details are provisional; the coordinators will confirm the final rules.
            </p>
            <div className="event-details__actions">
              <SpecularButton variant="ghost" onClick={onClose}>
                Close
              </SpecularButton>
              <SpecularButton aria-haspopup="dialog" onClick={() => onRegister(event)}>
                Register Now
              </SpecularButton>
            </div>
          </footer>
        </article>
      )}
    </Modal>
  );
}

interface DetailListProps {
  id: string;
  title: string;
  items: string[];
  ordered?: boolean;
}

function DetailList({ id, title, items, ordered = false }: DetailListProps) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <section className="event-details__block" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <List className={`event-details__list${ordered ? ' event-details__list--ordered' : ''}`}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </section>
  );
}
