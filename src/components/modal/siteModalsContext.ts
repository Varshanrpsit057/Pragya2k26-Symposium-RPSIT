import { createContext, useContext } from 'react';
import type { SymposiumEvent } from '../../content/types';

/** Opens the site's shared windows: the registration form, the event details and the Dev Crew. */
export interface SiteModals {
  /** `event` is the card the visitor came from, if any (mentioned in the form). */
  openRegistration: (event?: SymposiumEvent) => void;
  openEventDetails: (event: SymposiumEvent) => void;
  openDevCrew: () => void;
  /** True while any of these windows is open (the animated background rests meanwhile). */
  windowOpen: boolean;
}

const noop = () => {};

export const SiteModalsContext = createContext<SiteModals>({
  openRegistration: noop,
  openEventDetails: noop,
  openDevCrew: noop,
  windowOpen: false,
});

export function useSiteModals(): SiteModals {
  return useContext(SiteModalsContext);
}
