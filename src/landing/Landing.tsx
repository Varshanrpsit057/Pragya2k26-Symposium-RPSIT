import { site } from '../content/site';
import { DEFAULT_CATALOG } from '../lib/fest';
import { SiteNotice } from '../components/help/SiteNotice';
import { telHref, whatsappHref } from '../components/help/HelpDeskLine';
import './Landing.css';

/** Where staff sign in (every role; department staff may also use their department's page). */
export const STAFF_SIGN_IN = '/landing/admin/';

/**
 * The students' website (every department's events and the route map), run separately. Set it
 * to its address (e.g. 'https://events.example.com') to show the button; null hides it.
 */
export const EVENTS_SITE_URL: string | null = null;

const departments = DEFAULT_CATALOG.departments;
const eventCount = DEFAULT_CATALOG.events.length;
const helpLine = site.helpDesk.phones[0] ?? null;
const festDay = site.dates ?? 'the event day';

// The loop: a lemniscate of Bernoulli across a 600 × 240 box, one station per department.
const LOOP_W = 600;
const LOOP_H = 240;
const loopPoint = (t: number) => {
  const a = 270;
  const d = 1 + Math.sin(t) ** 2;
  return { x: LOOP_W / 2 + (a * Math.cos(t)) / d, y: LOOP_H / 2 + (a * Math.sin(t) * Math.cos(t)) / d };
};
const round = (value: number) => Math.round(value * 10) / 10;
const LOOP_PATH =
  Array.from({ length: 121 }, (_, index) => {
    const { x, y } = loopPoint((index / 120) * Math.PI * 2);
    return `${index ? 'L' : 'M'}${round(x)} ${round(y)}`;
  }).join(' ') + ' Z';
/** Stations at odd eighths of the loop, so none sits on the crossing in the middle. */
const STATIONS = departments.slice(0, 8).map((dept, index) => {
  const { x, y } = loopPoint(((2 * index + 1) * Math.PI) / 8);
  return { code: dept.code, x: round(x), y: round(y), above: y < LOOP_H / 2 };
});

function Loop() {
  return (
    <svg className="landing-loop" viewBox={`0 0 ${LOOP_W} ${LOOP_H}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="landing-loop-ink" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#45e3ff" />
          <stop offset="0.5" stopColor="#8c6cff" />
          <stop offset="1" stopColor="#ff8a4c" />
        </linearGradient>
      </defs>
      <path className="landing-loop__track" d={LOOP_PATH} />
      <path className="landing-loop__line" d={LOOP_PATH} pathLength={1} />
      {STATIONS.map((station, index) => (
        <g key={station.code} className="landing-loop__station" style={{ animationDelay: `${1.1 + index * 0.08}s` }}>
          <circle cx={station.x} cy={station.y} r="6" />
          <text x={station.x} y={station.above ? station.y - 16 : station.y + 28} textAnchor="middle">
            {station.code}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * pragya2k26.online: the fest's front door. Staff sign in from here; students are told where
 * to register and, once it is set, sent to the events and route map website.
 */
export function Landing() {
  return (
    <div className="landing">
      <header className="landing-top">
        <a className="landing-college" href={site.college.website} target="_blank" rel="noopener noreferrer">
          <img src="/images/rpsit-crest.webp" alt="" width="40" height="40" />
          <span>
            <strong>{site.college.name}</strong>
            <span>Salem</span>
          </span>
        </a>
      </header>

      <SiteNotice className="landing-notice" />

      <main id="main" className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <Loop />
          <h1 id="landing-title" className="landing-title">
            <span className="landing-title__wide">Infinite</span>
            <span className="landing-title__narrow">Techfest’26</span>
          </h1>
          {site.dates && <p className="landing-date">{site.dates}</p>}
          <p className="landing-lead">
            PRAGYA 2K26, the college-wide technical fest of {site.institution}: {eventCount} events across {departments.length} departments.
          </p>
          <div className="landing-actions">
            <a className="landing-button" href={STAFF_SIGN_IN}>
              Staff sign in
            </a>
            {EVENTS_SITE_URL && (
              <a className="landing-button landing-button--ghost" href={EVENTS_SITE_URL}>
                Events and route map
              </a>
            )}
          </div>
        </section>

        <section className="landing-block" aria-labelledby="landing-students">
          <h2 id="landing-students">Taking part?</h2>
          <p>
            Register at your department’s desk on campus on {festDay}. Already registered online? Give the desk the mobile number you
            registered with.
          </p>
          {EVENTS_SITE_URL && (
            <p>
              Every department’s events, and the way to each venue, are on the <a href={EVENTS_SITE_URL}>events and route map website</a>.
            </p>
          )}
        </section>

        <section className="landing-block" aria-labelledby="landing-departments">
          <h2 id="landing-departments">Department staff pages</h2>
          <p>Desks, event coordinators and HODs sign in on their department’s page.</p>
          <ul className="landing-depts">
            {departments.map((dept) => (
              <li key={dept.code}>
                <a href={`/landing/${dept.code.toLowerCase()}/admin/`}>
                  <span className="landing-depts__code">{dept.code}</span>
                  <span className="landing-depts__name">{dept.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="landing-foot">
        {helpLine && (
          <p>
            Need help? Call the help desk on <a href={telHref(helpLine.phone)}>{helpLine.phone}</a> or{' '}
            <a href={whatsappHref(helpLine.phone)} target="_blank" rel="noopener noreferrer">
              message on WhatsApp
            </a>
            .
          </p>
        )}
        <p className="landing-foot__address">
          {site.college.name}, {site.college.address}
        </p>
      </footer>
    </div>
  );
}
