import { useRef, type MouseEventHandler, type PointerEvent, type ReactNode } from 'react';
import './SpecularButton.css';

/*
 * CSS take on React Bits' Specular Button: a glass pill whose rim light swings toward
 * the cursor. The original renders a WebGL canvas per button; here a conic-gradient rim
 * driven by one custom property gives the same feel with no canvas and no idle work.
 */

interface SpecularButtonProps {
  children: ReactNode;
  href?: string;
  /** Opens the link in a new tab (registration forms). */
  external?: boolean;
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  /** Nudges the button toward the cursor. Used on hero-level calls to action. */
  magnetic?: boolean;
  disabled?: boolean;
  /** For a button: 'submit' inside a form. */
  type?: 'button' | 'submit';
  /** Waiting on something (e.g. a form being sent): announced as busy and dimmed. */
  busy?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-haspopup'?: 'dialog';
  onClick?: MouseEventHandler<HTMLElement>;
}

const MAGNET_STRENGTH = 0.18;
const MAGNET_LIMIT = 6;

export function SpecularButton({
  children,
  href,
  external = false,
  variant = 'primary',
  size = 'md',
  magnetic = false,
  disabled = false,
  type = 'button',
  busy = false,
  className,
  'aria-label': ariaLabel,
  'aria-haspopup': ariaHaspopup,
  onClick,
}: SpecularButtonProps) {
  const lastAngle = useRef(135);

  const classes = ['spec-btn', `spec-btn--${variant}`, `spec-btn--${size}`, busy && 'is-busy', className]
    .filter(Boolean)
    .join(' ');

  if (disabled) {
    return (
      <span className={`${classes} is-disabled`} aria-disabled="true" aria-label={ariaLabel}>
        <span className="spec-btn__label">{children}</span>
      </span>
    );
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);

    // Unwrap the angle so the CSS transition never spins the long way round.
    const raw = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    let angle = raw;
    while (angle - lastAngle.current > 180) angle -= 360;
    while (angle - lastAngle.current < -180) angle += 360;
    lastAngle.current = angle;

    el.style.setProperty('--spec-angle', `${angle}deg`);
    el.style.setProperty('--spec-x', `${event.clientX - rect.left}px`);
    el.style.setProperty('--spec-y', `${event.clientY - rect.top}px`);

    if (magnetic) {
      const clamp = (v: number) => Math.max(-MAGNET_LIMIT, Math.min(MAGNET_LIMIT, v));
      el.style.setProperty('--mag-x', `${clamp(dx * MAGNET_STRENGTH)}px`);
      el.style.setProperty('--mag-y', `${clamp(dy * MAGNET_STRENGTH)}px`);
    }
  };

  const handlePointerLeave = (event: PointerEvent<HTMLElement>) => {
    const el = event.currentTarget;
    el.style.removeProperty('--mag-x');
    el.style.removeProperty('--mag-y');
  };

  const content = <span className="spec-btn__label">{children}</span>;

  if (href) {
    return (
      <a
        className={classes}
        href={href}
        aria-label={ariaLabel}
        onClick={onClick}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      aria-label={ariaLabel}
      aria-haspopup={ariaHaspopup}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={onClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {content}
    </button>
  );
}
