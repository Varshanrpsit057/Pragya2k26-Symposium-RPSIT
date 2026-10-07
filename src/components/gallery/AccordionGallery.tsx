import { gsap } from 'gsap';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery';
import './AccordionGallery.css';

/*
 * React Bits' Accordion Gallery (JavaScript + CSS variant, GSAP), in TypeScript. A row of
 * image panels; the one under the pointer (or focused, or tapped) opens wide, the rest fold
 * into tilted, desaturated strips.
 *
 * Additions for this site, the original behaviour unchanged otherwise:
 *  - `activeIndex` / `onActiveChange` make it controllable (another part of the page can open
 *    a panel);
 *  - an item's `content` replaces the plain caption (the event's details and buttons), and is
 *    inert while its panel is folded, so hidden buttons are never focused;
 *  - `peek` is a short name shown on folded panels, so every strip says what it is;
 *  - `id` gives a panel an address for links (#event-…);
 *  - an index of -1 means no panel is open: all of them rest side by side, evenly, until
 *    one is hovered, tapped or focused; with `collapseOnLeave` the row folds back to that
 *    rest when the mouse leaves it;
 *  - the first paint (prerendered HTML, before GSAP runs) already shows the right layout.
 */

export interface AccordionItem {
  image: string;
  label?: string;
  link?: string;
  alt?: string;
  /** Rich caption for the open panel; replaces the label text. */
  content?: ReactNode;
  /** Shown on the folded panel. */
  peek?: string;
  id?: string;
}

export interface AccordionGalleryProps {
  items?: AccordionItem[];
  /** The panel open at first; -1 for none. */
  defaultIndex?: number;
  /** Controlled open panel (with onActiveChange); -1 for none. */
  activeIndex?: number;
  onActiveChange?: (index: number) => void;
  accentColor?: string;
  overlayColor?: string;
  textColor?: string;
  height?: number;
  gap?: number;
  radius?: number;
  expandRatio?: number;
  orientation?: 'horizontal' | 'vertical';
  duration?: number;
  ease?: string;
  parallax?: number;
  tilt?: number;
  stagger?: number;
  trigger?: 'hover' | 'click';
  showLabels?: boolean;
  grayscale?: boolean;
  /** How the panel images load (lazy below the fold). */
  loading?: 'lazy' | 'eager';
  /** Fold every panel back when the mouse leaves the row (hover trigger only). */
  collapseOnLeave?: boolean;
  className?: string;
  ariaLabel?: string;
}

const DEFAULT_ITEMS: AccordionItem[] = [
  { image: 'https://picsum.photos/id/1015/900/1200', label: 'Canyon', link: '#' },
  { image: 'https://picsum.photos/id/1018/900/1200', label: 'Ridgeline', link: '#' },
  { image: 'https://picsum.photos/id/1039/900/1200', label: 'Falls', link: '#' },
  { image: 'https://picsum.photos/id/1043/900/1200', label: 'Harbour', link: '#' },
  { image: 'https://picsum.photos/id/1044/900/1200', label: 'Skyline', link: '#' },
];

const clampRatio = (ratio: number) => Math.min(Math.max(ratio, 0.2), 0.9);

/** Folded panels at rest (none open): partly in colour and a little dimmed. */
const IDLE_GRAY = 0.45;
const IDLE_DIM = 0.22;

/** flex-grow of the open panel, so that it takes `ratio` of the row. */
const growFor = (ratio: number, count: number) => {
  const r = clampRatio(ratio);
  return count > 1 ? (r * (count - 1)) / (1 - r) : 1;
};

export default function AccordionGallery({
  items = DEFAULT_ITEMS,
  defaultIndex = 2,
  activeIndex,
  onActiveChange,
  accentColor = '#ffffff',
  overlayColor = '#060010',
  textColor = '#ffffff',
  height = 460,
  gap = 10,
  radius = 16,
  expandRatio = 0.52,
  orientation = 'horizontal',
  duration = 0.6,
  ease = 'power3.out',
  parallax = 0.5,
  tilt = 8,
  stagger = 0.06,
  trigger = 'hover',
  showLabels = true,
  grayscale = true,
  loading = 'lazy',
  collapseOnLeave = false,
  className = '',
  ariaLabel = 'Image accordion gallery',
}: AccordionGalleryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const mediaRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const textRefs = useRef<(HTMLDivElement | null)[]>([]);
  const peekRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const firstRunRef = useRef(true);
  const mediaSizeRef = useRef(320);

  const vertical = orientation === 'vertical';
  const count = items.length;
  const clampIndex = (index: number) => (index < 0 ? -1 : Math.min(index, count - 1));
  const [ownActive, setOwnActive] = useState(() => clampIndex(defaultIndex));
  const active = activeIndex === undefined ? ownActive : clampIndex(activeIndex);
  // The panel that is open in the prerendered HTML; its inline styles never change after
  // that (React leaves them alone), so GSAP alone animates from there on.
  const [firstActive] = useState(active);
  const prefersReduced = usePrefersReducedMotion();

  const setActive = useCallback(
    (index: number) => {
      setOwnActive(index);
      onActiveChange?.(index);
    },
    [onActiveChange],
  );

  const applyLayout = useCallback(
    (animate: boolean) => {
      const panels = panelRefs.current;
      if (!panels.length) return;

      const grow = growFor(expandRatio, count);
      const mediaSize = mediaSizeRef.current;

      tlRef.current?.kill();
      const dur = animate && !prefersReduced ? duration : 0;
      const tl = gsap.timeline();

      const idle = active < 0;
      panels.forEach((panel, i) => {
        if (!panel) return;
        const isActive = i === active;
        const media = mediaRefs.current[i];
        const bar = barRefs.current[i];
        const text = textRefs.current[i];
        const peek = peekRefs.current[i];

        // At rest (none open) the panels stand flat, side by side.
        const rot = isActive || idle ? 0 : i < active ? tilt : -tilt;
        const rotProp = vertical ? { rotateX: -rot } : { rotateY: rot };

        tl.to(panel, { flexGrow: isActive ? grow : 1, ...rotProp, duration: dur, ease }, 0);

        if (media) {
          const drift = idle ? 0 : Math.max(-1.5, Math.min(1.5, active - i));
          const shift = drift * parallax * mediaSize * 0.06;
          const gray = grayscale ? (isActive ? 0 : idle ? IDLE_GRAY : 1) : 0;
          tl.to(
            media,
            {
              xPercent: -50,
              yPercent: -50,
              x: vertical ? 0 : isActive ? 0 : shift,
              y: vertical ? (isActive ? 0 : shift) : 0,
              '--ag-gray': gray,
              '--ag-dim': isActive ? 0 : idle ? IDLE_DIM : 0.35,
              duration: dur,
              ease,
            },
            0,
          );
        }

        if (showLabels && bar && text) {
          if (isActive) {
            tl.to([bar, text], { opacity: 1, x: 0, duration: dur, ease, stagger: prefersReduced ? 0 : stagger }, 0);
          } else {
            tl.to([bar, text], { opacity: 0, x: -14, duration: dur * 0.6, ease }, 0);
          }
        }

        if (peek) tl.to(peek, { opacity: isActive ? 0 : 1, duration: dur * 0.6, ease }, isActive ? 0 : dur * 0.3);
      });

      tlRef.current = tl;
    },
    [active, count, expandRatio, duration, ease, vertical, tilt, parallax, grayscale, showLabels, stagger, prefersReduced],
  );

  // The latest layout function, for the resize observer (which stays connected).
  const layoutRef = useRef(applyLayout);
  useEffect(() => {
    layoutRef.current = applyLayout;
  }, [applyLayout]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const total = vertical ? rect.height : rect.width;
      const usable = Math.max(total - gap * (count - 1), 120);
      const size = Math.max(140, usable * clampRatio(expandRatio) * 1.22);
      mediaSizeRef.current = size;
      el.style.setProperty('--ag-media-size', `${size}px`);
      layoutRef.current(!firstRunRef.current);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gap, count, expandRatio, vertical]);

  useEffect(() => {
    applyLayout(!firstRunRef.current);
    firstRunRef.current = false;
  }, [applyLayout]);

  useEffect(
    () => () => {
      tlRef.current?.kill();
    },
    [],
  );

  // Only a mouse that really moves hovers. A tap fires a pretend hover first, which would open
  // the panel under the finger before its click lands (on whatever button just appeared there);
  // and when the page scrolls under a resting pointer (e.g. to a panel opened from elsewhere),
  // the browser reports the pointer over a new panel without any movement.
  const handleMove = (i: number, e: PointerEvent) => {
    if (trigger !== 'hover' || e.pointerType !== 'mouse' || i === active) return;
    if (e.movementX !== 0 || e.movementY !== 0) setActive(i);
  };

  const handleLeave = (e: PointerEvent) => {
    if (collapseOnLeave && trigger === 'hover' && e.pointerType === 'mouse' && active >= 0) setActive(-1);
  };

  const handleClick = (i: number, e: MouseEvent) => {
    if (i !== active) {
      e.preventDefault();
      setActive(i);
    }
  };

  const handleKeyDown = (i: number, e: KeyboardEvent) => {
    // Arrow keys move between panels only from the panel itself, not from a button inside it.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (i + 1) % count;
      setActive(next);
      panelRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const previous = (i - 1 + count) % count;
      setActive(previous);
      panelRefs.current[previous]?.focus();
    }
  };

  const firstGrow = growFor(expandRatio, count);

  return (
    <div
      ref={rootRef}
      className={`accordion-gallery${vertical ? ' accordion-gallery--vertical' : ''}${className ? ` ${className}` : ''}`}
      style={
        {
          '--ag-accent': accentColor,
          '--ag-overlay': overlayColor,
          '--ag-text': textColor,
          '--ag-gap': `${gap}px`,
          '--ag-radius': `${radius}px`,
          height: vertical ? `${Math.round(height * 1.6)}px` : `${height}px`,
        } as CSSProperties
      }
      role="list"
      aria-label={ariaLabel}
      data-idle={active < 0 ? '' : undefined}
      onPointerLeave={handleLeave}
    >
      {items.map((item, i) => {
        const isActive = i === active;
        const Tag = item.link ? 'a' : 'div';
        const firstRot = firstActive < 0 || i === firstActive ? 0 : i < firstActive ? tilt : -tilt;
        return (
          <Tag
            key={item.id ?? i}
            id={item.id}
            ref={(el: HTMLElement | null) => {
              panelRefs.current[i] = el;
            }}
            className={`ag-panel${isActive ? ' ag-panel--active' : ''}`}
            style={{
              borderRadius: `${radius}px`,
              flexGrow: i === firstActive ? firstGrow : 1,
              transform: vertical ? `rotateX(${-firstRot}deg)` : `rotateY(${firstRot}deg)`,
            }}
            href={item.link || undefined}
            onClick={(e: MouseEvent) => handleClick(i, e)}
            onPointerMove={(e: PointerEvent) => handleMove(i, e)}
            onFocus={() => {
              if (i !== active) setActive(i);
            }}
            onKeyDown={(e: KeyboardEvent) => handleKeyDown(i, e)}
            role="listitem"
            tabIndex={0}
            aria-current={isActive ? 'true' : undefined}
            aria-label={item.label}
          >
            <span className="ag-panel__frame">
              <span
                className="ag-panel__media"
                ref={(el) => {
                  mediaRefs.current[i] = el;
                }}
              >
                <img src={item.image} alt={item.alt ?? item.label ?? ''} draggable="false" loading={loading} decoding="async" />
              </span>
              <span className="ag-panel__overlay" aria-hidden="true" />
            </span>
            {item.peek && (
              <div
                className="ag-panel__peek"
                aria-hidden="true"
                ref={(el) => {
                  peekRefs.current[i] = el;
                }}
              >
                {item.peek}
              </div>
            )}
            {showLabels && (
              <div
                className={`ag-panel__label${item.content ? ' ag-panel__label--rich' : ''}`}
                aria-hidden={item.content ? undefined : true}
                inert={!isActive}
              >
                <div
                  className="ag-panel__bar"
                  ref={(el) => {
                    barRefs.current[i] = el;
                  }}
                />
                <div
                  className="ag-panel__text"
                  ref={(el) => {
                    textRefs.current[i] = el;
                  }}
                >
                  {item.content ?? item.label}
                </div>
              </div>
            )}
          </Tag>
        );
      })}
    </div>
  );
}
