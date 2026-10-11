/**
 * A pop-up window over the dashboard, so the desk never scrolls between a list and a form:
 * the whole screen for a new registration, most of it for a student's record. Esc or Close
 * shuts it (after a question when something would be lost); with two open, Esc shuts the
 * top one only.
 */
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Kept in view at the bottom: the main buttons. */
  footer?: ReactNode;
  size?: 'full' | 'large' | 'small';
  /** Asked before closing, when closing would lose something (a half-filled form). */
  confirmClose?: string | null;
}

/** The open dialogs, newest last: only the top one answers Esc. */
const stack: string[] = [];

export function Dialog({ title, subtitle, onClose, children, footer, size = 'large', confirmClose }: DialogProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    if (!confirmClose || window.confirm(confirmClose)) onClose();
  }, [confirmClose, onClose]);

  useEffect(() => {
    stack.push(id);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The first field with autoFocus takes the focus; otherwise the window itself.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => {
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stack.at(-1) === id) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, id]);

  return (
    <div className="adm-dialog">
      <div ref={panel} className={`adm-dialog__panel adm-dialog__panel--${size}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <header className="adm-dialog__head">
          <div>
            <h2 id={`${id}-title`} className="adm-dialog__title">
              {title}
            </h2>
            {subtitle && <p className="adm-muted adm-dialog__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="adm-button adm-dialog__close" onClick={close}>
            Close <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="adm-dialog__body">{children}</div>
        {footer && <footer className="adm-dialog__foot">{footer}</footer>}
      </div>
    </div>
  );
}
