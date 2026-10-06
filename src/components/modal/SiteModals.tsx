import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { site } from '../../content/site';
import type { SymposiumEvent } from '../../content/types';
import { isRegistrationClosed } from '../../lib/registration';
import { EventDetailsModal } from '../events/EventDetailsModal';
import { RegistrationModal } from '../registration/RegistrationModal';
import { DevCrewModal } from '../sections/DevCrew';
import { SiteModalsContext } from './siteModalsContext';

/**
 * Holds the page's shared windows. Every Register Now button opens the same registration
 * form; every See More opens the same event-details window; the footer's incognito button
 * opens the Dev Crew.
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

  const windowOpen = registration.open || detailsEvent !== null || crewOpen;
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
      />
      <DevCrewModal open={crewOpen} onClose={closeDevCrew} />
    </SiteModalsContext.Provider>
  );
}
