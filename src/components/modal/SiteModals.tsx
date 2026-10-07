import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { site } from '../../content/site';
import type { SymposiumEvent } from '../../content/types';
import { isRegistrationClosed } from '../../lib/registration';
import type { OwnRegistration } from '../../lib/registrationClient';
import { parseStatusHash, statusHash } from '../../lib/statusLink';
import { EventDetailsModal } from '../events/EventDetailsModal';
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
 * opens the Dev Crew; a private status link (#status=…) opens the registration status.
 */
export function SiteModalsProvider({ children }: { children: ReactNode }) {
  // `request` counts openings, so the form can pre-select the event behind each one;
  // `closed` is decided at the moment of opening, against registration.closesAt.
  const [registration, setRegistration] = useState<{
    open: boolean;
    event?: SymposiumEvent;
    request: number;
    closed: boolean;
  }>({ open: false, request: 0, closed: false });
  const [detailsEvent, setDetailsEvent] = useState<SymposiumEvent | null>(null);
  const [crewOpen, setCrewOpen] = useState(false);
  const hash = useSyncExternalStore(subscribeToHash, readHash, noHash);
  const statusOf = useMemo(() => parseStatusHash(hash), [hash]);

  const openRegistration = useCallback((event?: SymposiumEvent) => {
    setDetailsEvent(null);
    const closed = isRegistrationClosed(site.registration.closesAt, Date.now());
    setRegistration((current) => ({ open: true, event, request: current.request + 1, closed }));
  }, []);
  const openEventDetails = useCallback((event: SymposiumEvent) => setDetailsEvent(event), []);
  const closeRegistration = useCallback(() => setRegistration((current) => ({ ...current, open: false })), []);
  const closeEventDetails = useCallback(() => setDetailsEvent(null), []);
  const openDevCrew = useCallback(() => setCrewOpen(true), []);
  const closeDevCrew = useCallback(() => setCrewOpen(false), []);
  const openStatus = useCallback((own: OwnRegistration) => {
    window.location.hash = statusHash(own);
  }, []);
  // Closing the status window takes the private key back out of the address bar.
  const closeStatus = useCallback(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);

  const windowOpen = registration.open || detailsEvent !== null || crewOpen || statusOf !== null;
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
        closed={registration.closed}
        onClose={closeRegistration}
        onCheckStatus={openStatus}
      />
      <StatusModal own={statusOf} onClose={closeStatus} />
      <DevCrewModal open={crewOpen} onClose={closeDevCrew} />
    </SiteModalsContext.Provider>
  );
}
