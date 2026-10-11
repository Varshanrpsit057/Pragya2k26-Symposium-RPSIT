import { useSchedule } from '../lib/liveSchedule';
import { registrationPhase, type RegistrationPhase } from '../lib/schedule';
import { useNow } from './useNow';

/**
 * Online, on-site or closed, by the visitor's clock and the schedule the API gives (a test
 * timeline can change it; the API enforces the same schedule by its own). 'online' while
 * hydrating, so the prerendered page and the first render match. Re-renders every second:
 * use it in small components.
 */
export function useRegistrationPhase(): RegistrationPhase {
  const schedule = useSchedule();
  const now = useNow();
  return now === null ? 'online' : registrationPhase(schedule, now);
}
