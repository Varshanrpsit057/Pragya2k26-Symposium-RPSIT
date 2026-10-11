import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { SymposiumEvent } from '../../content/types';
import { currentSchedule } from '../../lib/liveSchedule';
import { registrationPhase, type RegistrationPhase } from '../../lib/schedule';
import type { OwnRegistration } from '../../lib/registrationClient';
import { parseStatusHash, statusHash } from '../../lib/statusLink';
import { EventDetailsModal } from '../events/EventDetailsModal';
import { RouteMapModal, parseRouteHash } from '../map/RouteMapModal';
import { RegistrationModal } from '../registration/RegistrationModal';
import { StatusModal } from '../registration/StatusModal';
import { DevCrewModal } from '../sections/DevCrew';
import { SiteModalsContext } from './siteModalsContext';

/** The page address's #fragment, kept in step with the browser (empty while prerendering). */
const subscribeToHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const readHash = () => window.location.hash;
const noHash = () => '';

/**
 * Holds the page's shared windows. Every Register Now button opens the same registration
 * form; every See More opens the same event-details window; the footer's incognito button
 * opens the Dev Crew; a private status link (#status=…) opens the registration status; and
 * #route-map (or #route-map=<event>), from the Route map buttons, opens the route map.
 */
export function SiteModalsProvider({ children }: { children: ReactNode }) {
  // `request` counts openings, so the form can pre-select the event behind each one;
  // `phase` (online, on-site or closed) is decided at the moment of opening, by the clock.
  const [registration, setRegistration] = useState<{
    open: boolean;
    event?: SymposiumEvent;
    request: number;
    phase: RegistrationPhase;
  }>({ open: false, request: 0, phase: 'online' });
  const [detailsEvent, setDetailsEvent] = useState<SymposiumEvent | null>(null);
  const [crewOpen, setCrewOpen] = useState(false);
  const hash = useSyncExternalStore(subscribeToHash, readHash, noHash);
  const statusOf = useMemo(() => parseStatusHash(hash), [hash]);
  const routeOf = useMemo(() => parseRouteHash(hash), [hash]);

  const openRegistration = useCallback((event?: SymposiumEvent) => {
    setDetailsEvent(null);
    const phase = registrationPhase(currentSchedule(), Date.now());
    setRegistration((current) => ({ open: true, event, request: current.request + 1, phase }));
  }, []);
  const openEventDetails = useCallback((event: SymposiumEvent) => setDetailsEvent(event), []);
  const closeRegistration = useCallback(() => setRegistration((current) => ({ ...current, open: false })), []);
  const closeEventDetails = useCallback(() => setDetailsEvent(null), []);
  const openDevCrew = useCallback(() => setCrewOpen(true), []);
  const closeDevCrew = useCallback(() => setCrewOpen(false), []);
  const openStatus = useCallback((own: OwnRegistration) => {
    window.location.hash = statusHash(own);
  }, []);
  // Closing the status window takes the private key back out of the address bar (and the
  // route map its #route-map).
  const closeStatus = useCallback(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);

  const windowOpen = registration.open || detailsEvent !== null || crewOpen || statusOf !== null || routeOf !== null;
  const value = useMemo(
    () => ({ openRegistration, openEventDetails, openDevCrew, windowOpen }),
    [openRegistration, openEventDetails, openDevCrew, windowOpen],
  );

  return (
    <SiteModalsContext.Provider value={value}>
      {children}
      <EventDetailsModal event={detailsEvent} onClose={closeEventDetails} onRegister={openRegistration} />
      <RegistrationModal
        open={registration.open}
        event={registration.event}
        request={registration.request}
        phase={registration.phase}
        onClose={closeRegistration}
        onCheckStatus={openStatus}
      />
      <StatusModal own={statusOf} onClose={closeStatus} />
      <RouteMapModal open={routeOf !== null} eventId={routeOf?.eventId ?? null} onClose={closeStatus} />
      <DevCrewModal open={crewOpen} onClose={closeDevCrew} />
    </SiteModalsContext.Provider>
  );
}
