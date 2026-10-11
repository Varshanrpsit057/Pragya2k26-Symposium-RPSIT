import { useEffect, useState } from 'react';
import { useSchedule } from '../lib/liveSchedule';
import { eventDayWindow, isEventDay } from '../lib/schedule';

/** setTimeout's longest wait (about 24.8 days); a longer one is re-checked then. */
const MAX_WAIT = 2 ** 31 - 1;

/**
 * True on the event day (all day, by the visitor's clock): the website then offers Student
 * login instead of Register Now. False while hydrating, so the prerendered page and
 * the first render match. Unlike useRegistrationPhase it does not tick every second: it
 * re-renders only when the day starts or ends, so large components may use it.
 */
export function useEventDay(): boolean {
  const schedule = useSchedule();
  const [eventDay, setEventDay] = useState(false);
  useEffect(() => {
    let timer = 0;
    const check = () => {
      const now = Date.now();
      setEventDay(isEventDay(schedule, now));
      const day = eventDayWindow(schedule);
      const boundaries = (day ? [day.start, day.end] : []).filter((at) => at > now);
      if (boundaries.length) timer = window.setTimeout(check, Math.min(Math.min(...boundaries) - now + 50, MAX_WAIT));
    };
    check();
    return () => window.clearTimeout(timer);
  }, [schedule]);
  return eventDay;
}
