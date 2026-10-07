import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { categoryLabels, eventAnchor, eventsByCategory } from '../../content/events';
import type { EventCategory, SymposiumEvent } from '../../content/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { getEventFocus, getServerEventFocus, subscribeEventFocus } from '../../lib/eventFocus';
import AccordionGallery, { type AccordionItem } from '../gallery/AccordionGallery';
import { EventIcon } from '../icons/EventIcon';
import { useSiteModals } from '../modal/siteModalsContext';
import { RegisterButton } from '../ui/RegisterButton';
import { SpecularButton } from '../ui/SpecularButton';
import './EventsSection.css';

interface EventsSectionProps {
  category: EventCategory;
  title: string;
  lead: string;
}

/** The track's colour for the caption bar and focus ring (tokens.css: synapse / flare). */
const ACCENTS: Record<EventCategory, string> = { technical: '#45e3ff', 'non-technical': '#ff5cc8' };

/**
 * One track's five events as React Bits' Accordion Gallery: the open panel shows the event
 * (name, description, See More, Register Now); hovering, focusing or tapping another opens it.
 * Phones stack the panels in a column. The carousel, the map of events and #event-… links
 * open an event here (lib/eventFocus.ts).
 */
export function EventsSection({ category, title, lead }: EventsSectionProps) {
  const list = eventsByCategory(category);
  const titleId = `${category}-title`;
  const stacked = useMediaQuery('(max-width: 640px)');
  const roomy = useMediaQuery('(min-width: 960px)');

  const [active, setActive] = useState(Math.min(2, list.length - 1));
  // A request to show an event (from elsewhere on the page) opens its panel, once per request.
  const focus = useSyncExternalStore(subscribeEventFocus, getEventFocus, getServerEventFocus);
  const [handled, setHandled] = useState(0);
  if (focus.n !== handled) {
    setHandled(focus.n);
    const index = list.findIndex((event) => event.id === focus.id);
    if (index >= 0) setActive(index);
  }

  const items: AccordionItem[] = list.map((event) => ({
    id: eventAnchor(event),
    image: event.posterLarge ?? event.poster ?? '',
    alt: '',
    label: event.name,
    peek: event.name,
    content: <EventCaption event={event} />,
  }));

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

        <div className="events-section__gallery" data-reveal style={{ '--reveal-delay': '140ms' } as CSSProperties}>
          <AccordionGallery
            items={items}
            activeIndex={active}
            onActiveChange={setActive}
            orientation={stacked ? 'vertical' : 'horizontal'}
            height={stacked ? 470 : roomy ? 540 : 480}
            expandRatio={stacked ? 0.58 : 0.52}
            gap={stacked ? 8 : 12}
            radius={18}
            accentColor={ACCENTS[category]}
            overlayColor="#05061a"
            trigger="hover"
            ariaLabel={title}
          />
        </div>
      </div>
    </section>
  );
}

/** What the open panel says about its event. */
function EventCaption({ event }: { event: SymposiumEvent }) {
  const { openEventDetails } = useSiteModals();
  return (
    <div className="event-panel" data-category={event.category}>
      <div className="event-panel__top">
        <span className="event-panel__icon" aria-hidden="true">
          <EventIcon name={event.icon} size={22} />
        </span>
        <span className="event-panel__category">{categoryLabels[event.category]}</span>
      </div>
      <h3 className="event-panel__name">{event.name}</h3>
      {event.subtitle && !event.name.toLowerCase().includes(event.subtitle.toLowerCase()) && (
        <p className="event-panel__subtitle">{event.subtitle}</p>
      )}
      <p className="event-panel__description">{event.description}</p>
      <div className="event-panel__actions">
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
    </div>
  );
}
