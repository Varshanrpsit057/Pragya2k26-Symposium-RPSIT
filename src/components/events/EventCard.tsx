import { categoryLabels, eventAnchor } from '../../content/events';
import type { SymposiumEvent } from '../../content/types';
import { trackPointer } from '../../lib/pointer';
import { EventIcon } from '../icons/EventIcon';
import { useSiteModals } from '../modal/siteModalsContext';
import { RegisterButton } from '../ui/RegisterButton';
import { SpecularButton } from '../ui/SpecularButton';
import './EventCard.css';

interface EventCardProps {
  event: SymposiumEvent;
}

export function EventCard({ event }: EventCardProps) {
  const titleId = `${eventAnchor(event)}-title`;
  const { openEventDetails } = useSiteModals();

  return (
    <article
      id={eventAnchor(event)}
      className="event-card"
      data-category={event.category}
      aria-labelledby={titleId}
      onPointerMove={trackPointer}
    >
      {event.poster && (
        // The artwork from the event poster; decorative, since the name is in the heading.
        <div className="event-card__media">
          <img
            src={event.poster}
            alt=""
            width={300}
            height={400}
            loading="lazy"
            decoding="async"
          />
        </div>
      )}

      <div className="event-card__top">
        <span className="event-card__icon">
          <EventIcon name={event.icon} size={26} />
        </span>
        <span className="event-card__category">{categoryLabels[event.category]}</span>
      </div>

      <div className="event-card__heading">
        <h3 id={titleId} className="event-card__name">
          {event.name}
        </h3>
        {event.subtitle && <p className="event-card__subtitle">{event.subtitle}</p>}
      </div>

      <p className="event-card__description">{event.description}</p>

      <EventDetails event={event} />

      <div className="event-card__actions">
        <SpecularButton
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          aria-label={`See more about ${event.name}`}
          onClick={() => openEventDetails(event)}
        >
          See More
        </SpecularButton>
        <RegisterButton event={event} size="sm" />
      </div>
    </article>
  );
}

/** Optional details from the content file. Renders nothing until at least one is set. */
export function EventDetails({ event }: EventCardProps) {
  const facts = [
    { label: 'Team size', value: event.teamSize },
    { label: 'Venue', value: event.venue },
    { label: 'Schedule', value: event.schedule },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  const rules = event.rules ?? [];
  const coordinators = event.coordinators ?? [];

  if (facts.length === 0 && rules.length === 0 && coordinators.length === 0) return null;

  return (
    <div className="event-card__details">
      {facts.length > 0 && (
        <dl className="event-card__facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {rules.length > 0 && (
        <details className="event-card__rules">
          <summary>Rules</summary>
          <ul>
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </details>
      )}

      {coordinators.length > 0 && (
        <div className="event-card__coordinators">
          <p className="event-card__coordinators-title">Coordinators</p>
          <ul>
            {coordinators.map((person) => (
              <li key={`${person.name}-${person.phone ?? person.email ?? ''}`}>
                <span>{person.name}</span>
                {person.phone && <a href={`tel:${person.phone.replace(/\s+/g, '')}`}>{person.phone}</a>}
                {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
