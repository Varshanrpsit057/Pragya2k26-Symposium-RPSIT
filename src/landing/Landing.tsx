import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { SkyBackdrop } from '../components/background/SkyBackdrop';
import { CollegeLockup } from '../components/CollegeLockup';
import { SiteNotice } from '../components/help/SiteNotice';
import { Footer, type FooterLink } from '../components/sections/Footer';
import { site } from '../content/site';
import { DEFAULT_CATALOG, deptShort } from '../lib/fest';
import './Landing.css';

/** The students' page: register on their phone, then their ID and payment status. */
export const REGISTER = '/register/';
/** "My registration ID": the students' page opened on their registration (this phone's own, or found by mobile number). */
export const MY_ID = '/register/?my';

const FOOTER_LINKS: readonly FooterLink[] = [
  { id: 'register', label: 'Register', href: REGISTER },
  { id: 'my-id', label: 'My registration ID', href: MY_ID },
];

/**
 * The events website (every department's events), run separately: it opens in a new tab.
 * null hides the links to it.
 */
export const EVENTS_SITE_URL: string | null = 'https://infinite-techfest-2026.vercel.app';
/** Opens the events website in a new tab, without giving it this page. */
const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

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

/** The pop-up of Register now: the 8 departments; each opens the students' page for it. */
function ChooseDepartment({ onClose }: { onClose: () => void }) {
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="landing-modal" onClick={onClose}>
      <div className="landing-modal__panel" role="dialog" aria-modal="true" aria-labelledby="landing-choose" onClick={(event) => event.stopPropagation()}>
        <div className="landing-modal__head">
          <h2 id="landing-choose">Choose your department</h2>
          <button className="landing-modal__close" type="button" aria-label="Close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p>You register for one department and take part in its events.</p>
        <ul className="landing-modal__list">
          {departments.map((dept, index) => (
            <li key={dept.code}>
              <a ref={index === 0 ? first : undefined} href={`${REGISTER}?dept=${dept.code}`}>
                <span className="landing-modal__code">{deptShort(dept.code)}</span>
                <span className="landing-modal__name">{dept.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * pragya2k26.online: the fest's front door, for students: where to register and, once it is
 * set, the events and route map website. It links to no staff page: staff open /landing/admin/
 * (it lists every department's staff page) by its address.
 */
export function Landing() {
  const [choosing, setChoosing] = useState(false);
  // Register now opens the departments (without JavaScript the link still goes to the students' page).
  const openChooser = (event: MouseEvent) => {
    event.preventDefault();
    setChoosing(true);
  };
  return (
    <>
      {/* The PRAGYA sky: a still gradient at once, the slow light streaks on capable devices only */}
      <SkyBackdrop />
    <div id="home" className="landing">
      <header className="landing-top">
        <a className="landing-college" href={site.college.website} target="_blank" rel="noopener noreferrer">
          <CollegeLockup />
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
          <p className="landing-portal">On-site Registration Portal</p>
          {site.dates && <p className="landing-date">{site.dates}</p>}
          <p className="landing-lead">
            Infinite Techfest’26, the college-wide technical fest of {site.institution}: {eventCount} events across {departments.length} departments.
          </p>
          <div className="landing-actions">
            <a className="landing-button" href={REGISTER} aria-haspopup="dialog" onClick={openChooser}>
              Register now
            </a>
            <a className="landing-button landing-button--ghost" href={MY_ID}>
              My registration ID
            </a>
            {EVENTS_SITE_URL && (
              <a className="landing-button landing-button--ghost" href={EVENTS_SITE_URL} {...NEW_TAB}>
                Explore events
                <span className="landing-button__out" aria-hidden="true">
                  ↗
                </span>
              </a>
            )}
          </div>
        </section>


        <section className="landing-block" aria-labelledby="landing-students">
          <h2 id="landing-students">Taking part?</h2>
          <ol className="landing-steps">
            <li>
              <a href={REGISTER} aria-haspopup="dialog" onClick={openChooser}>
                Register on your phone
              </a>
              : choose your department and fill in your details. You get your registration ID at once.
            </li>
            <li>
              Pay the ₹{DEFAULT_CATALOG.entryFee} entry fee: by UPI right after registering (scan the QR code and send the UTR), or in cash at your department’s registration desk. Show
              your ID at the desk: it verifies your payment.
            </li>
            <li>Register for events at each event’s venue, in your department, on {festDay}.</li>
          </ol>
          <p>Lost your ID? Open My registration ID: on the phone you registered with it shows at once; on another phone, your mobile number finds it.</p>
        </section>
      </main>

    </div>
      <Footer links={FOOTER_LINKS} />
      {choosing && <ChooseDepartment onClose={() => setChoosing(false)} />}
      <p className="landing-coordinated">
        Overall coordinated by the <strong>Department of Artificial Intelligence and Data Science</strong>
      </p>
    </>
  );
}
