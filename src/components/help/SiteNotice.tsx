import { useState } from 'react';
import { useSiteNotice } from '../../lib/liveSchedule';
import './SiteNotice.css';

const HIDDEN_KEY = 'pragya-notice-hidden';

function readHidden(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(HIDDEN_KEY);
  } catch {
    return null;
  }
}

/**
 * The notice an admin posts on the event day (e.g. "COGNIX has moved to LH-05"), on the home
 * page and the student page. A visitor can hide it; a new notice shows again.
 */
export function SiteNotice({ className = '' }: { className?: string }) {
  const notice = useSiteNotice();
  const [hidden, setHidden] = useState(readHidden);
  if (!notice || hidden === notice.setAt) return null;
  const hide = () => {
    setHidden(notice.setAt);
    try {
      window.localStorage.setItem(HIDDEN_KEY, notice.setAt);
    } catch {
      // Private mode: hidden for this visit only.
    }
  };
  return (
    <aside className={`site-notice ${className}`.trim()} role="status" aria-label="Notice from the organisers">
      <span className="site-notice__label">Notice</span>
      <p className="site-notice__text">{notice.text}</p>
      <button type="button" className="site-notice__hide" aria-label="Hide this notice" onClick={hide}>
        ×
      </button>
    </aside>
  );
}
