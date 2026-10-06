import { useEffect, useState, type RefObject } from 'react';

interface InViewOptions {
  rootMargin?: string;
  threshold?: number;
  /** Stop observing after the element first enters the viewport. */
  once?: boolean;
}

/** Tracks whether an element is in the viewport, so animations can pause when it isn't. */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { rootMargin = '0px', threshold = 0, once = false }: InViewOptions = {},
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) observer.disconnect();
      },
      { rootMargin, threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, threshold, once]);

  return inView;
}
