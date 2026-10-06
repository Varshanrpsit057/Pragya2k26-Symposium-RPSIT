import type { SymposiumEvent } from '../../content/types';
import { useSiteModals } from '../modal/siteModalsContext';
import { SpecularButton } from './SpecularButton';

interface RegisterButtonProps {
  /** The event card the button sits on, if any (named in its label and in the form). */
  event?: SymposiumEvent;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'ghost';
  magnetic?: boolean;
  className?: string;
}

/** Every Register Now button: opens the one registration form, in a window on the page. */
export function RegisterButton({
  event,
  label = 'Register Now',
  size = 'md',
  variant = 'primary',
  magnetic,
  className,
}: RegisterButtonProps) {
  const { openRegistration } = useSiteModals();

  return (
    <SpecularButton
      size={size}
      variant={variant}
      magnetic={magnetic}
      className={className}
      aria-haspopup="dialog"
      aria-label={event ? `${label} for ${event.name}` : undefined}
      onClick={() => openRegistration(event)}
    >
      {label}
    </SpecularButton>
  );
}
