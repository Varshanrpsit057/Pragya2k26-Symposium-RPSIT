import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { eventAnchor, events } from '../../content/events';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import CircularCarousel, {
  type CarouselItem,
  type CircularCarouselHandle,
} from '../carousel/CircularCarousel';
import { ArrowIcon } from '../icons/ArrowIcon';
import { Pillars } from '../text/Pillars';
import './EventOrbit.css';

/*
 * Event showcase: the event posters on React Bits' Circular Carousel. It turns on its own
 * in one smooth, continuous motion (no stop at each poster), and keeps going with the mouse
 * over it; only a finger, keyboard focus or a drag holds it. Selecting the front poster,
 * or the View details button, jumps to that event's card.
 *
 * Phones get a panorama (camera inside the ring) with flat cards, so posters stay
 * large and the GPU has far fewer layers to composite; larger screens get the
 * full bent-card cylinder.
 */

export const SHOWCASE_EVENTS = events.filter((event) => event.poster);

/**
 * How fast the ring turns, in degrees a second. With 10 posters (36° apart) a new one
 * reaches the front about every 3.6 s, the same pace as before but without stopping.
 */
const DRIFT_DEG_PER_S = 10;

const PILLARS = ['Think', 'Create', 'Compete', 'Innovate'] as const;

const ITEMS: CarouselItem[] = SHOWCASE_EVENTS.map((event) => ({
  src: event.poster as string,
  alt: `${event.name} poster`,
  title: event.name,
  subtitle: event.subtitle,
}));

export function EventOrbit() {
  const carouselRef = useRef<CircularCarouselHandle>(null);
  const [active, setActive] = useState(0);
  const compact = useMediaQuery('(max-width: 767px), (pointer: coarse)');
  const activeEvent = SHOWCASE_EVENTS[active] ?? SHOWCASE_EVENTS[0];

  const openDetails = (index: number) => {
    const event = SHOWCASE_EVENTS[index];
    if (event) window.location.hash = eventAnchor(event);
  };

  const layout = useMemo(
    () =>
      compact
        ? ({ preset: 'panorama', cardWidth: 230, gap: 22, curve: 0 } as const)
        : ({ preset: 'cylinder', cardWidth: 250, gap: 30, curve: undefined } as const),
    [compact],
  );

  if (!activeEvent) return null;

  return (
    <section id="events" className="section orbit-section" aria-labelledby="events-title">
      <div className="container">
        <header className="section-head orbit-section__head">
          <h2 id="events-title" className="section-title" data-reveal>
            PRAGYA 2026&nbsp;— One&nbsp;Stage, Endless Possibilities
          </h2>
          <p className="section-motto" data-reveal style={{ '--reveal-delay': '60ms' } as CSSProperties}>
            Where innovation, creativity, and competition come together.
          </p>
          <p className="section-lead" data-reveal style={{ '--reveal-delay': '120ms' } as CSSProperties}>
            A dynamic symposium bringing together young minds to explore ideas, showcase talent, take
            on exciting challenges, and experience the spirit of technology and creativity.
          </p>
          <Pillars words={PILLARS} style={{ '--reveal-delay': '180ms' } as CSSProperties} />
        </header>
      </div>

      <div className="orbit-showcase" data-layout={layout.preset}>
        <CircularCarousel
          ref={carouselRef}
          items={ITEMS}
          preset={layout.preset}
          curve={layout.curve}
          cardWidth={layout.cardWidth}
          gap={layout.gap}
          aspectRatio={3 / 4}
          intro="rise"
          autoplay="drift"
          speed={DRIFT_DEG_PER_S}
          pauseOnHover={false}
          backfaces={false}
          cornerRadius={18}
          depthFade={0.6}
          fadeColor="#05061a"
          parallax={0.25}
          ariaLabel="PRAGYA 2026 event posters"
          onChange={setActive}
          onItemClick={(_, index) => {
            // A side card first turns to the front; only the front card opens details.
            if (index === active) openDetails(index);
          }}
        />
      </div>

      <div className="orbit__controls">
        <button
          type="button"
          className="orbit__arrow"
          onClick={() => carouselRef.current?.prev()}
          aria-label="Previous event"
        >
          <ArrowIcon direction="left" />
        </button>
        <div className="orbit__status" data-category={activeEvent.category}>
          <span className="orbit__position">
            {active + 1} / {SHOWCASE_EVENTS.length}
          </span>
          <span className="orbit__current">{activeEvent.name}</span>
          <a className="orbit__details" href={`#${eventAnchor(activeEvent)}`}>
            View details
          </a>
        </div>
        <button
          type="button"
          className="orbit__arrow"
          onClick={() => carouselRef.current?.next()}
          aria-label="Next event"
        >
          <ArrowIcon direction="right" />
        </button>
      </div>
    </section>
  );
}
