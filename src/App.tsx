import { SkyBackdrop } from './components/background/SkyBackdrop';
import { EventOrbit } from './components/events/EventOrbit';
import { EventsSection } from './components/events/EventsSection';
import { Hero } from './components/hero/Hero';
import { SiteModalsProvider } from './components/modal/SiteModals';
import { useSiteModals } from './components/modal/siteModalsContext';
import { PillNav, type NavItem } from './components/nav/PillNav';
import { Footer } from './components/sections/Footer';
import { RegisterCTA } from './components/sections/RegisterCTA';
import { site } from './content/site';
import { useRevealOnScroll } from './hooks/useRevealOnScroll';

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'events', label: 'About' },
  { id: 'technical', label: 'Technical' },
  { id: 'non-technical', label: 'Non-technical' },
  { id: 'contact', label: 'Contact' },
];

const REGISTER_ITEM: NavItem = { id: 'register', label: 'Register' };

/** Every section in page order, for the nav's scroll tracking. */
const SECTION_IDS = [
  'home',
  'events',
  'technical',
  'non-technical',
  'register',
  'contact',
] as const;

const FOOTER_LINKS: readonly NavItem[] = [
  { id: 'events', label: 'All events' },
  { id: 'technical', label: 'Technical events' },
  { id: 'non-technical', label: 'Non-technical events' },
  { id: 'register', label: 'Register' },
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
  const { openRegistration } = useSiteModals();

  return (
    <>
      <a className="skip-link" href="#events">
        Skip to content
      </a>
      <SkyBackdrop />
      <PillNav
        items={NAV_ITEMS}
        sectionIds={SECTION_IDS}
        brandLabel={site.name}
        cta={REGISTER_ITEM}
        onCtaClick={() => openRegistration()}
      />

      <main id="main">
        <Hero />
        <EventOrbit />
        <EventsSection
          category="technical"
          title="Technical events"
          lead="Five events on AI, code and data: build from a prompt, visualize, present, code and quiz."
        />
        <EventsSection
          category="non-technical"
          title="Non-technical events"
          lead="Five events on design, film, observation, branding and gaming."
        />
        <RegisterCTA />
      </main>

      <Footer links={FOOTER_LINKS} />
    </>
  );
}
