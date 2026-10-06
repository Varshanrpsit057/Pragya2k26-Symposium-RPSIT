import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import './Modal.css';

/*
 * A window over the page, built on the native <dialog>: the browser traps focus inside,
 * makes the page behind inert, closes on Esc and returns focus to the button that opened it.
 */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** id of the heading that names the window */
  labelledBy: string;
  /** Close when the dimmed area around the window is clicked. Off for forms, so a stray
      click cannot throw away what has been typed. */
  closeOnBackdrop?: boolean;
  /** Only the window's own buttons close it: Esc and the phone's back gesture are ignored,
      so a form cannot be lost by accident. Implies closeOnBackdrop={false}. */
  locked?: boolean;
  /** Keep the content mounted while closed (a form keeps its draft). */
  keepMounted?: boolean;
  /** Selector of the element to focus on opening, e.g. a form's first field. */
  initialFocus?: string;
  className?: string;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  labelledBy,
  closeOnBackdrop = true,
  locked = false,
  keepMounted = false,
  initialFocus,
  className,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && dialog.open) dialog.close();
  }, [open, initialFocus]);

  // Only a click that both starts and ends on the backdrop closes the window, so selecting
  // text inside and releasing outside does not.
  const isBackdrop = (event: MouseEvent<HTMLDialogElement>) => event.target === event.currentTarget;

  return (
    <dialog
      ref={dialogRef}
      className={['modal', className].filter(Boolean).join(' ')}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        // A file chooser dismissed without picking a file fires a `cancel` that bubbles up
        // to here; only the dialog's own cancel (Esc, the back gesture) is meant to close it.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!locked) onClose();
      }}
      onClose={() => {
        // The browser can still close a dialog on its own (e.g. repeated back gestures):
        // keep the page's state in step so the window can be opened again.
        if (open) onClose();
      }}
      onMouseDown={(event) => {
        pressedOnBackdrop.current = isBackdrop(event);
      }}
      onClick={(event) => {
        if (closeOnBackdrop && !locked && pressedOnBackdrop.current && isBackdrop(event)) onClose();
      }}
    >
      <div className="modal__panel">
        <button type="button" className="modal__close icon-link" aria-label="Close" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        {(open || keepMounted) && children}
      </div>
    </dialog>
  );
}
