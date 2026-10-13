import { SkyBackdrop } from '../components/background/SkyBackdrop';
import { SiteNotice } from '../components/help/SiteNotice';
import { Footer, type FooterLink } from '../components/sections/Footer';
import { site } from '../content/site';
import { DEFAULT_CATALOG, deptShort } from '../lib/fest';
import './Landing.css';

/** Where staff sign in (every role; department staff may also use their department's page). */
export const STAFF_SIGN_IN = '/landing/admin/';
/** The students' page: register on their phone, then their ID and payment status. */
export const REGISTER = '/register/';
/** "My registration ID": the students' page opened on their registration (ID and mobile number). */
export const MY_ID = '/register/?my';

const FOOTER_LINKS: readonly FooterLink[] = [
  { id: 'register', label: 'Register', href: REGISTER },
  { id: 'my-id', label: 'My registration ID', href: MY_ID },
  { id: 'staff', label: 'Staff sign in', href: STAFF_SIGN_IN },
];

/**
 * The students' website (every department's events and the route map), run separately. Set it
 * to its address (e.g. 'https://events.example.com') to show the button; null hides it.
 */
export const EVENTS_SITE_URL: string | null = null;

const departments = DEFAULT_CATALOG.departments;
const eventCount = DEFAULT_CATALOG.events.length;
const festDay = site.dates ?? 'the event day';

// The loop: a lemniscate of Bernoulli across a 600 × 240 box, one station per department.
const LOOP_W = 600;
const LOOP_H = 240;
/** Space above and below the loop for the names at the top and bottom dots. */
const LOOP_PAD = 38;
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
/** The coordinating department (AI&DS) sits at the loop's crossing; the others around it. */
const HUB = 'AIDS';
/** Where each department sits on the loop (its angle on the curve): three on the left, four on the right. */
const PLACES: Record<string, number> = {
  ECE: 0.75 * Math.PI,
  IT: Math.PI,
  CYS: 1.25 * Math.PI,
  MECH: -Math.PI / 3,
  SH: -Math.PI / 9,
  CSE: Math.PI / 9,
  EEE: Math.PI / 3,
};
const ringDepartments = departments.filter((dept) => dept.code !== HUB);
// A department added later (no place set) spreads the whole ring evenly instead.
const placed = ringDepartments.every((dept) => dept.code in PLACES);

/** The loop's colour at a point (cyan on the left, violet in the middle, orange on the right), lightened for text. */
const INK = [
  [69, 227, 255],
  [140, 108, 255],
  [255, 138, 76],
];
const inkAt = (x: number) => {
  const f = Math.min(Math.max((x - 30) / 540, 0), 1);
  const [from, to, k] = f < 0.5 ? [INK[0], INK[1], f * 2] : [INK[1], INK[2], (f - 0.5) * 2];
  const channel = (i: number) => Math.round((from[i] + (to[i] - from[i]) * k) * 0.55 + 255 * 0.45);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
};

const STATIONS = ringDepartments.map((dept, index) => {
  const t = placed ? PLACES[dept.code] : ((2 * index + 1) * Math.PI) / ringDepartments.length;
  const { x, y } = loopPoint(t);
  return { code: deptShort(dept.code), x: round(x), y: round(y), above: y <= LOOP_H / 2, ink: inkAt(x) };
});
const hub = departments.find((dept) => dept.code === HUB);

function Loop() {
  return (
    <svg className="landing-loop" viewBox={`0 ${-LOOP_PAD} ${LOOP_W} ${LOOP_H + 2 * LOOP_PAD}`} aria-hidden="true" focusable="false">
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
          <text x={station.x} y={station.above ? station.y - 16 : station.y + 33} textAnchor="middle" style={{ fill: station.ink }}>
            {station.code}
          </text>
        </g>
      ))}
      {hub && (
        // AI&DS, coordinating the fest, at the crossing in the middle.
        <g className="landing-loop__station landing-loop__hub" style={{ animationDelay: `${1.1 + STATIONS.length * 0.08}s` }}>
          <circle className="landing-loop__hub-ring" cx={LOOP_W / 2} cy={LOOP_H / 2} r="17" />
          <circle cx={LOOP_W / 2} cy={LOOP_H / 2} r="9" />
          <text x={LOOP_W / 2} y={LOOP_H / 2 + 45} textAnchor="middle">
            {deptShort(hub.code)}
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * pragya2k26.online: the fest's front door. Staff sign in from here; students are told where
 * to register and, once it is set, sent to the events and route map website.
 */
export function Landing() {
  return (
    <>
      {/* The PRAGYA sky: a still gradient at once, the slow light streaks on capable devices only */}
      <SkyBackdrop />
    <div id="home" className="landing">
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
            <a className="landing-button" href={REGISTER}>
              Register now
            </a>
            <a className="landing-button landing-button--ghost" href={MY_ID}>
              My registration ID
            </a>
            {EVENTS_SITE_URL && (
              <a className="landing-button landing-button--ghost" href={EVENTS_SITE_URL}>
                Events and route map
              </a>
            )}
          </div>
          <a className="landing-staff" href={STAFF_SIGN_IN}>
            Staff sign in
          </a>
        </section>

        <section className="landing-block" aria-labelledby="landing-students">
          <h2 id="landing-students">Taking part?</h2>
          <ol className="landing-steps">
            <li>
              <a href={REGISTER}>Register on your phone</a>: your details, the ₹{DEFAULT_CATALOG.entryFee} entry fee by UPI and its transaction ID. You get your registration ID at once.
            </li>
            <li>Verify your payment at any registration desk: show your ID.</li>
            <li>Register for events at each event’s venue, in any department, on {festDay}.</li>
          </ol>
          <p>Registered online already? Give the desk the mobile number you registered with.</p>
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
                  <span className="landing-depts__code">{deptShort(dept.code)}</span>
                  <span className="landing-depts__name">{dept.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>

    </div>
      <Footer links={FOOTER_LINKS} />
      <p className="landing-coordinated">
        Overall coordinated by the <strong>Department of Artificial Intelligence and Data Science</strong>
      </p>
    </>
  );
}
