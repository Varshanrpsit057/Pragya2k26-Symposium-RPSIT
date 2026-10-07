import { useEffect, useRef } from 'react';
import { PragyaEmblem } from './PragyaEmblem';
import './BrandEmblem.css';

/** The hero keeps an empty square with this id where the emblem first appears. */
export const EMBLEM_SLOT_ID = 'hero-emblem';

/** How visible the emblem stays once it has settled into the background. */
const REST_OPACITY = 0.1;
/** How much of a screen's height of scrolling takes it from the hero to the background. */
const TRAVEL = 0.85;

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

/**
 * The PRAGYA emblem as a layer of the page's background (between the sky and the content).
 *
 * At the top of the page it sits exactly in the hero's emblem square. Scrolling down, it
 * grows to fill the screen, drifts to the centre and fades until it is only just visible,
 * and stays there behind every section. Only transform and opacity change, once per frame.
 * With reduced motion it simply stays in the hero.
 *
 * It appears once JavaScript has placed it (the hero's wordmark and text are in the HTML).
 */
export function BrandEmblem() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const slot = document.getElementById(EMBLEM_SLOT_ID);
    if (!layer || !slot) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    const place = () => {
      frame = 0;
      const rect = slot.getBoundingClientRect();
      const size = rect.width;
      if (!size) return;
      const scrollY = window.scrollY;
      layer.style.width = `${size}px`;
      layer.style.height = `${size}px`;

      if (reduced.matches) {
        // In the hero, scrolling with the page like any other content.
        layer.style.position = 'absolute';
        layer.style.opacity = '1';
        layer.style.transform = `translate3d(${rect.left + window.scrollX}px, ${rect.top + scrollY}px, 0)`;
        return;
      }

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const progress = smoothstep(clamp01(scrollY / (vh * TRAVEL)));
      // Where the square is with the page at the top, and the centre of the screen.
      const fromX = rect.left + size / 2;
      const fromY = rect.top + scrollY + size / 2;
      const x = fromX + (vw / 2 - fromX) * progress;
      const y = fromY + (vh / 2 - fromY) * progress;
      const scale = 1 + ((Math.max(vw, vh) * 1.05) / size - 1) * progress;
      const fade = smoothstep(clamp01((scrollY / (vh * TRAVEL)) * 1.25));

      layer.style.position = 'fixed';
      layer.style.opacity = String(1 - (1 - REST_OPACITY) * fade);
      layer.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0) scale(${scale})`;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };

    place();
    layer.dataset.ready = 'true';
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    reduced.addEventListener('change', schedule);
    // The hero settles once its web font has loaded: place the emblem again then.
    document.fonts?.ready.then(schedule).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reduced.removeEventListener('change', schedule);
    };
  }, []);

  return (
    <div ref={ref} className="brand-emblem" aria-hidden="true">
      <PragyaEmblem className="brand-emblem__art" />
    </div>
  );
}
