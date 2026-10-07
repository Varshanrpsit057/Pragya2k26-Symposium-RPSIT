import { useRef, type CSSProperties } from 'react';
import { events } from '../../content/events';
import { useInView } from '../../hooks/useInView';
import { EventIcon } from '../icons/EventIcon';
import './DriftWall.css';

/*
 * Inspired by React Bits' Drift Wall: an endless, tilted wall of event posters drifting
 * past. Each column is a CSS animation on transform (compositor only), paused whenever
 * the wall is off screen. Tiles lift on hover. Purely decorative.
 */

/** Matches the plane's grid in DriftWall.css. */
const COLUMNS = 9;

const columns = Array.from({ length: COLUMNS }, (_, c) => {
  const offset = (c * 3) % events.length;
  return [...events.slice(offset), ...events.slice(0, offset)];
});

export function DriftWall() {
  const ref = useRef<HTMLDivElement>(null);
  const running = useInView(ref, { rootMargin: '100px 0px' });

  return (
    <div ref={ref} className={`drift-wall ${running ? 'is-running' : ''}`} aria-hidden="true">
      <div className="drift-wall__plane">
        {columns.map((column, c) => (
          <div
            key={c}
            className="drift-wall__column"
            style={
              {
                '--duration': `${46 + (c % 3) * 9}s`,
                '--direction': c % 2 === 0 ? 'normal' : 'reverse',
              } as CSSProperties
            }
          >
            {/* Two identical halves: translating by -50% loops seamlessly */}
            <div className="drift-wall__track">
              {[...column, ...column].map((event, i) =>
                event.poster ? (
                  <div
                    key={`${event.id}-${i}`}
                    className="drift-tile drift-tile--poster"
                    data-category={event.category}
                  >
                    <img
                      src={event.poster}
                      alt=""
                      width={300}
                      height={400}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                  </div>
                ) : (
                  <div key={`${event.id}-${i}`} className="drift-tile" data-category={event.category}>
                    <EventIcon name={event.icon} size={20} />
                    <span>{event.name}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
