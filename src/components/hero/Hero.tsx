import pragyaLogo from '../../assets/brand/pragya-2k26-logo.webp';
import { site } from '../../content/site';
import { RegisterButton } from '../ui/RegisterButton';
import { SpecularButton } from '../ui/SpecularButton';
import { Countdown } from './Countdown';
import './Hero.css';

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
          <h1 id="hero-title" className="hero__title">
            <span className="sr-only">
              {site.name} {site.year}
            </span>
            {/* The PRAGYA 2K26 emblem and wordmark; the heading text above is what is read out */}
            <img className="hero__logo" src={pragyaLogo} alt="" width={580} height={448} fetchPriority="high" />
          </h1>
          {site.dates && <p className="hero__date">{site.dates}</p>}
        </div>

        {site.registration.closesAt && (
          <Countdown target={site.registration.closesAt} label="Registration closes in" endedLabel="Registration closed" />
        )}

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
