import { site } from '../content/site';
import { registrationPhase, scheduleOf, type RegistrationPhase } from '../lib/schedule';
import { useNow } from './useNow';

const schedule = scheduleOf(site.registration);

/**
 * Online, on-site or closed, by the visitor's clock (the API enforces the same schedule by
 * its own). 'online' while hydrating, so the prerendered page and the first render match.
 * Re-renders every second: use it in small components.
 */
export function useRegistrationPhase(): RegistrationPhase {
  const now = useNow();
  return now === null ? 'online' : registrationPhase(schedule, now);
}
