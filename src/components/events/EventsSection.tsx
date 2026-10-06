import type { CSSProperties } from 'react';
import { eventsByCategory } from '../../content/events';
import type { EventCategory } from '../../content/types';
import { EventCard } from './EventCard';
import './EventsSection.css';

interface EventsSectionProps {
  category: EventCategory;
  title: string;
  lead: string;
  /** 'lead-pair': two wide cards then three; 'trail-pair': three then two wide. */
  layout: 'lead-pair' | 'trail-pair';
}

export function EventsSection({ category, title, lead, layout }: EventsSectionProps) {
  const list = eventsByCategory(category);
  const titleId = `${category}-title`;

  return (
    <section id={category} className="section events-section" data-category={category} aria-labelledby={titleId}>
      <div className="container">
        <header className="section-head events-section__head">
          <span className="events-section__signal" aria-hidden="true" />
          <h2 id={titleId} className="section-title" data-reveal>
            {title}
          </h2>
          <p className="section-lead" data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
            {lead}
          </p>
        </header>

        <ul className={`event-grid event-grid--${layout}`}>
          {list.map((event, index) => (
            <li
              key={event.id}
              data-reveal
              style={{ '--reveal-delay': `${(index % 3) * 90}ms` } as CSSProperties}
            >
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
