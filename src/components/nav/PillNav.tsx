import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useScrollSpy } from '../../hooks/useScrollSpy';
import { IncognitoIcon } from '../icons/IncognitoIcon';
import './PillNav.css';

/*
 * Inspired by React Bits' Pill Nav: floating glass pill, hover fill that rises from
 * below with a rolling label, and a highlight that slides to the active section.
 * Built with CSS transitions; no GSAP or router needed for a single page.
 */

export interface NavItem {
  id: string;
  label: string;
}

interface PillNavProps {
  items: readonly NavItem[];
  /** Every section id in page order, for scroll tracking. Ids without a nav item clear the highlight. */
  sectionIds: readonly string[];
  brandLabel: string;
  cta: NavItem;
  /** Run instead of following the CTA's link (it opens the registration form). */
  onCtaClick?: () => void;
  /** Opens the Dev Crew: an incognito button right after the last link (Contact). */
  onCrewClick?: () => void;
}

// Runs before paint in the browser; harmless no-op during server rendering.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function PillNav({ items, sectionIds, brandLabel, cta, onCtaClick, onCrewClick }: PillNavProps) {
  const activeId = useScrollSpy(sectionIds);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const placeIndicator = useCallback(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (!list || !indicator) return;

    const link = list.querySelector<HTMLElement>(`a[data-id="${activeId}"]`);
    if (!link) {
      indicator.style.opacity = '0';
      return;
    }
    indicator.style.opacity = '1';
    indicator.style.width = `${link.offsetWidth}px`;
    indicator.style.transform = `translate3d(${link.offsetLeft}px, 0, 0)`;
  }, [activeId]);

  useIsomorphicLayoutEffect(() => {
    placeIndicator();
  }, [placeIndicator]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => placeIndicator());
    observer.observe(list);
    document.fonts?.ready.then(placeIndicator).catch(() => {});
    return () => observer.disconnect();
  }, [placeIndicator]);

  // Close the mobile menu on Escape or a click outside it.
  useEffect(() => {
    if (!menuOpen) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !toggleRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKey);
    document.addEventListener('pointerdown', handlePointer);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('pointerdown', handlePointer);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const handleCtaClick = (event: MouseEvent<HTMLAnchorElement>) => {
    closeMenu();
    if (!onCtaClick) return;
    event.preventDefault();
    onCtaClick();
  };

  return (
    <header className="nav-shell">
      <nav className="pill-nav" aria-label="Primary">
        <a className="pill-nav__brand" href="#home" title={`${brandLabel} 2026`} onClick={closeMenu}>
          {/* The crest is decorative: the college name beside it labels the link */}
          <img className="pill-nav__logo" src="/images/rpsit-logo-sm.webp" alt="" width="73" height="120" />
          <span className="pill-nav__college">
            <span className="pill-nav__college-name">R P Sarathy</span>
            <span className="pill-nav__college-type">Institute of Technology</span>
          </span>
        </a>

        <div className="pill-nav__track">
          <span ref={indicatorRef} className="pill-nav__indicator" aria-hidden="true" />
          <ul ref={listRef} className="pill-nav__items">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  className="pill"
                  href={`#${item.id}`}
                  data-id={item.id}
                  aria-current={activeId === item.id ? 'true' : undefined}
                >
                  <span className="pill__stack">
                    <span className="pill__label">{item.label}</span>
                    <span className="pill__label pill__label--hover" aria-hidden="true">
                      {item.label}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {onCrewClick && (
            <button
              type="button"
              className="icon-link pill-nav__crew"
              aria-label="Meet the Dev Crew"
              title="Meet the Dev Crew"
              aria-haspopup="dialog"
              onClick={onCrewClick}
            >
              <IncognitoIcon size={17} />
            </button>
          )}
        </div>

        <a
          className="pill-nav__cta"
          href={`#${cta.id}`}
          aria-current={activeId === cta.id ? 'true' : undefined}
          aria-haspopup={onCtaClick ? 'dialog' : undefined}
          onClick={handleCtaClick}
        >
          {cta.label}
        </a>

        <button
          ref={toggleRef}
          type="button"
          className="pill-nav__toggle"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="pill-nav__toggle-line" />
          <span className="pill-nav__toggle-line" />
        </button>
      </nav>

      <div
        id="mobile-menu"
        ref={menuRef}
        className="pill-nav__menu"
        data-open={menuOpen ? 'true' : undefined}
        inert={!menuOpen}
      >
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} aria-current={activeId === item.id ? 'true' : undefined} onClick={closeMenu}>
                {item.label}
              </a>
            </li>
          ))}
          {onCrewClick && (
            <li>
              <button
                type="button"
                className="pill-nav__menu-crew"
                aria-haspopup="dialog"
                onClick={() => {
                  closeMenu();
                  onCrewClick();
                }}
              >
                <IncognitoIcon size={18} />
                Dev Crew
              </button>
            </li>
          )}
          <li>
            <a
              href={`#${cta.id}`}
              aria-current={activeId === cta.id ? 'true' : undefined}
              aria-haspopup={onCtaClick ? 'dialog' : undefined}
              onClick={handleCtaClick}
            >
              {cta.label}
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}
