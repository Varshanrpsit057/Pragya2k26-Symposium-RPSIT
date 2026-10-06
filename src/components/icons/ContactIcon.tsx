import type { ReactNode } from 'react';

export type ContactIconName = 'pin' | 'phone' | 'mail' | 'external';

/** Stroke artwork on a 24×24 grid, matching the event icons. */
const contactIconPaths: Record<ContactIconName, ReactNode> = {
  pin: (
    <>
      <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  phone: (
    <path d="M21 16.4v2.8a1.9 1.9 0 0 1-2.1 1.9 18.8 18.8 0 0 1-8.2-2.9 18.5 18.5 0 0 1-5.7-5.7A18.8 18.8 0 0 1 2.1 4.2 1.9 1.9 0 0 1 4 2.1h2.8a1.9 1.9 0 0 1 1.9 1.6c.12.9.34 1.8.66 2.7a1.9 1.9 0 0 1-.43 2L7.7 9.6a15.2 15.2 0 0 0 5.7 5.7l1.2-1.2a1.9 1.9 0 0 1 2-.43c.87.32 1.8.54 2.7.66a1.9 1.9 0 0 1 1.6 1.9z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
};

interface ContactIconProps {
  name: ContactIconName;
  size?: number;
  className?: string;
}

export function ContactIcon({ name, size = 18, className }: ContactIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {contactIconPaths[name]}
    </svg>
  );
}
