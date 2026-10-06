import type { CSSProperties } from 'react';
import { events } from '../../content/events';
import { site } from '../../content/site';
import TextType from '../text/TextType';
import { RegisterButton } from '../ui/RegisterButton';
import { SpecularButton } from '../ui/SpecularButton';
import { Countdown } from './Countdown';
import './Hero.css';

const tickerPhrases = events.map((event) =>
  event.subtitle ? `${event.name}: ${event.subtitle}` : event.name,
);
const tickerColors = events.map((event) =>
  event.category === 'technical' ? '#6fe9ff' : '#ff8ad8',
);
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);

const technicalCount = events.filter((event) => event.category === 'technical').length;
const nonTechnicalCount = events.length - technicalCount;

export function Hero() {
  // The date is shown large in the lockup; only the venue is left for the facts below.
  const hasFacts = Boolean(site.venue);

  return (
    <section id="home" className="hero" aria-labelledby="hero-title">
      {/* The sky itself is page-wide (SkyBackdrop); this only shades the text side */}
      <div className="hero__veil" aria-hidden="true" />

      <div className="container hero__inner">
        <div className="hero__lockup">
          <p className="hero__department">
            <span className="hero__department-of">Department of</span> {site.department}
          </p>
          <h1 id="hero-title" className="hero__title">
            <span className="sr-only">
              {site.name} {site.year}
            </span>
            <span className="wordmark" aria-hidden="true">
              {[...site.name].map((char, index) => (
                <span
                  key={index}
                  className="wordmark__char"
                  style={{ '--i': index } as CSSProperties}
                >
                  {char}
                </span>
              ))}
            </span>
          </h1>
          <div className="hero__meta">
            <span className="hero__year" aria-hidden="true">
              {site.year}
            </span>
            <span className="hero__rule" aria-hidden="true" />
            <p className="hero__host">{site.institution}</p>
          </div>
          {site.dates && <p className="hero__date">{site.dates}</p>}
        </div>

        {site.registration.closesAt && (
          <Countdown target={site.registration.closesAt} label="Registration closes in" endedLabel="Registration closed" />
        )}

        <p className="hero__tagline">
          {site.tagline} with {inWords(technicalCount)} technical and{' '}
          {inWords(nonTechnicalCount)} non-technical events.
        </p>

        <p className="hero__ticker">
          <span className="hero__ticker-node" aria-hidden="true" />
          <span className="sr-only">Events: {events.map((event) => event.name).join(', ')}.</span>
          <TextType
            as="span"
            aria-hidden
            className="hero__ticker-text"
            text={tickerPhrases}
            textColors={tickerColors}
            typingSpeed={55}
            deletingSpeed={22}
            pauseDuration={1800}
            initialDelay={1600}
            cursorCharacter="▍"
            cursorBlinkDuration={0.55}
            staticText={`${events.length} events across two tracks`}
          />
        </p>

        <div className="hero__actions">
          <RegisterButton size="lg" magnetic className="spec-btn--intro" />
          <SpecularButton href="#events" variant="ghost" size="lg">
            Explore the events
          </SpecularButton>
        </div>

        {hasFacts && (
          <dl className="hero__facts">
            {site.venue && (
              <div>
                <dt>Where</dt>
                <dd>{site.venue}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </section>
  );
}
