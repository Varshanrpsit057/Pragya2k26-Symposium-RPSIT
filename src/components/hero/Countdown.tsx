import { useNow } from '../../hooks/useNow';
import { formatIst, parseEventStart, remainingUntil } from '../../lib/countdown';
import './Countdown.css';

interface CountdownProps {
  /** The moment to count down to, e.g. '2026-10-16T17:00:00' (IST). */
  target: string;
  /** Above the boxes, e.g. 'Registration closes in'. */
  label: string;
  /** Shown instead of the boxes once the moment has passed. */
  endedLabel: string;
}

const UNITS = ['days', 'hours', 'minutes', 'seconds'] as const;

/** Live countdown in the hero: days, hours, minutes and seconds, updated every second. */
export function Countdown({ target, label, endedLabel }: CountdownProps) {
  const now = useNow();
  const end = parseEventStart(target);
  if (end === null) return null;

  // null while hydrating: the boxes show dashes for that first instant.
  const remaining = now === null ? null : remainingUntil(end, now);

  if (remaining?.done) {
    return (
      <p className="countdown countdown--ended" role="status">
        <span className="countdown__ended-dot" aria-hidden="true" />
        {endedLabel}
      </p>
    );
  }

  return (
    <div className="countdown" role="timer" aria-labelledby="countdown-label">
      <p id="countdown-label" className="countdown__label">
        {label}
      </p>
      <ol className="countdown__units">
        {UNITS.map((unit) => (
          <li key={unit} className="countdown__unit">
            <span className="countdown__value">{remaining ? String(remaining[unit]).padStart(2, '0') : '--'}</span>
            <span className="countdown__name">{unit}</span>
          </li>
        ))}
      </ol>
      <p className="countdown__date">
        <time dateTime={new Date(end).toISOString()}>{formatIst(end)}</time>
      </p>
    </div>
  );
}
