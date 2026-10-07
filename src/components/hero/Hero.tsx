import { site } from '../../content/site';
import { EMBLEM_SLOT_ID } from '../brand/BrandEmblem';
import { RegisterButton } from '../ui/RegisterButton';
import { SpecularButton } from '../ui/SpecularButton';
import { Countdown } from './Countdown';
import './Hero.css';

/** 'PRAGYA' and '2026' → the edition mark '2K26'. */
const edition = `${site.year.slice(0, 1)}K${site.year.slice(-2)}`;

export function Hero() {
  // The date is shown large in the lockup; only the venue is left for the facts below.
  const hasFacts = Boolean(site.venue);

  return (
    <section id="home" className="hero" aria-labelledby="hero-title">
      {/* The sky itself is page-wide (SkyBackdrop); this only shades the area behind the lockup */}
      <div className="hero__veil" aria-hidden="true" />

      <div className="container hero__inner">
        <div className="hero__lockup">
          <p className="hero__department">
            <span className="hero__department-of">Department of</span>
            <span className="hero__department-name">{site.department}</span>
          </p>
          {/* The emblem (BrandEmblem, a background layer) appears in this square, then drifts
              into the background as the page scrolls. */}
          <div id={EMBLEM_SLOT_ID} className="hero__emblem-slot" aria-hidden="true" />
          <h1 id="hero-title" className="hero__title">
            <span className="sr-only">
              {site.name} {site.year}
            </span>
            <span className="hero__wordmark" aria-hidden="true">
              {site.name}
            </span>
            <span className="hero__edition" aria-hidden="true">
              <span className="hero__edition-rule" />
              {edition}
              <span className="hero__edition-rule" />
            </span>
          </h1>
          {site.dates && <p className="hero__date">{site.dates}</p>}
        </div>

        {site.registration.closesAt && (
          <Countdown target={site.registration.closesAt} label="Registration closes in" endedLabel="Registration closed" />
        )}

        <div className="hero__actions">
          <RegisterButton size="lg" magnetic className="spec-btn--intro" />
          <SpecularButton href="#technical" variant="ghost" size="lg">
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
