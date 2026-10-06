import { useEffect, useState } from 'react';

/**
 * Returns the id of the section currently crossing a band near the middle of the viewport.
 * The last section also becomes active once it is mostly visible, because a short
 * final section (the footer) may never reach the band.
 */
export function useScrollSpy(ids: readonly string[]): string {
  const [activeId, setActiveId] = useState(ids[0]);

  useEffect(() => {
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const band = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    sections.forEach((section) => band.observe(section));

    const last = sections[sections.length - 1];
    const tail = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setActiveId(last.id);
      },
      { threshold: 0.6 },
    );
    tail.observe(last);

    return () => {
      band.disconnect();
      tail.disconnect();
    };
  }, [ids]);

  return activeId;
}
