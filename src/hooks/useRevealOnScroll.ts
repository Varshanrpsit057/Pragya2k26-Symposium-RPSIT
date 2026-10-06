import { useEffect } from 'react';

/**
 * Reveals every [data-reveal] element the first time it scrolls into view.
 * One shared observer for the whole page. Content stays visible if JavaScript
 * never runs, because the hidden state only applies under html.reveal-ready.
 */
export function useRevealOnScroll(): void {
  useEffect(() => {
    const root = document.documentElement;
    const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');

    if (!('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );

    targets.forEach((target) => observer.observe(target));
    root.classList.add('reveal-ready');

    return () => {
      observer.disconnect();
      root.classList.remove('reveal-ready');
    };
  }, []);
}
