import { SkyBackdrop } from './components/background/SkyBackdrop';
import { BrandEmblem } from './components/brand/BrandEmblem';
import { EventOrbit } from './components/events/EventOrbit';
import { EventsSection } from './components/events/EventsSection';
import { HelpDeskSection } from './components/help/HelpDeskSection';
import { Hero } from './components/hero/Hero';
import { SiteModalsProvider } from './components/modal/SiteModals';
import { useSiteModals } from './components/modal/siteModalsContext';
import { PillNav, type NavItem } from './components/nav/PillNav';
import { Footer } from './components/sections/Footer';
import { RegisterCTA } from './components/sections/RegisterCTA';
import { site } from './content/site';
import { useEventDay } from './hooks/useEventDay';
import { useRevealOnScroll } from './hooks/useRevealOnScroll';
import { STUDENT_PAGE } from './lib/student';

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'events', label: 'About' },
  { id: 'technical', label: 'Events' },
  { id: 'help', label: 'Help desk' },
  { id: 'contact', label: 'Contact' },
];

const REGISTER_ITEM: NavItem = { id: 'register', label: 'Register' };
/** On the event day the CTA goes to the student page (pass and events) instead. */
const STUDENT_ITEM: NavItem = { id: 'student', label: 'Student login' };

/** Every section in page order, for the nav's scroll tracking. */
const SECTION_IDS = [
  'home',
  'events',
  'technical',
  'register',
  'help',
  'contact',
] as const;

const FOOTER_LINKS: readonly NavItem[] = [
  { id: 'events', label: 'All events' },
  { id: 'technical', label: 'Technical events' },
  { id: 'register', label: 'Register' },
  { id: 'help', label: 'Help desk' },
  // Opens the route map window (not a section).
  { id: 'route-map', label: 'Route map' },
];

export function App() {
  useRevealOnScroll();

  return (
    <SiteModalsProvider>
      <Page />
    </SiteModalsProvider>
  );
}

function Page() {
  const { openRegistration, openDevCrew } = useSiteModals();
  const eventDay = useEventDay();

  return (
    <>
      <a className="skip-link" href="#events">
        Skip to content
      </a>
      <SkyBackdrop />
      <BrandEmblem />
      <PillNav
        items={NAV_ITEMS}
        sectionIds={SECTION_IDS}
        brandLabel={site.name}
        cta={eventDay ? STUDENT_ITEM : REGISTER_ITEM}
        ctaHref={eventDay ? STUDENT_PAGE : undefined}
        onCtaClick={eventDay ? undefined : () => openRegistration()}
        onCrewClick={openDevCrew}
      />

      <main id="main">
        <Hero />
        <EventOrbit />
        <EventsSection
          category="technical"
          title="Technical events"
          lead="Five events on AI, code and data: build from a prompt, visualize, present, code and quiz."
        />
        <RegisterCTA />
        <HelpDeskSection />
      </main>

      <Footer links={FOOTER_LINKS} />
    </>
  );
}
