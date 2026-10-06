import type { ReactNode } from 'react';
import type { EventIconName } from '../../content/types';

/** Stroke artwork on a 24×24 grid, shared by the icon component and the event map. */
export const eventIconPaths: Record<EventIconName, ReactNode> = {
  prompt: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 10l3 2.25L7 14.5" />
      <path d="M12.5 15h4.5" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M7.5 15l3.5-4 3 2.5L19 7" />
      <circle cx="19" cy="7" r="1.25" />
    </>
  ),
  paper: (
    <>
      <path d="M6 3h8l4.5 4.5V21H6z" />
      <path d="M14 3v4.5h4.5" />
      <path d="M9 12.5h6.5M9 16.5h6.5" />
    </>
  ),
  code: (
    <>
      <path d="M8.5 7.5L4 12l4.5 4.5" />
      <path d="M15.5 7.5L20 12l-4.5 4.5" />
      <path d="M13.25 5.5l-2.5 13" />
    </>
  ),
  quiz: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.25c-.7.33-1.1.9-1.1 1.6v.4" />
      <circle cx="12" cy="17" r=".6" />
    </>
  ),
  vector: (
    <>
      <path d="M5 18C7 9 17 9 19 18" />
      <path d="M12 6v6" />
      <rect x="3" y="16.5" width="3.5" height="3.5" rx=".75" />
      <rect x="17.5" y="16.5" width="3.5" height="3.5" rx=".75" />
      <rect x="10.25" y="3" width="3.5" height="3.5" rx=".75" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M7.5 4.5v15M16.5 4.5v15" />
      <path d="M3 9.5h4.5M3 14.5h4.5M16.5 9.5H21M16.5 14.5H21" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  tag: (
    <>
      <path d="M20.4 13.4l-7 7a2 2 0 0 1-2.8 0L3.5 13.3V3.5h9.8l7.1 7.1a2 2 0 0 1 0 2.8z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  gamepad: (
    <>
      <path d="M7 7.5h10a4.5 4.5 0 0 1 4.5 4.5v.8a3.7 3.7 0 0 1-6.6 2.3L13.8 13.7h-3.6l-1.1 1.4A3.7 3.7 0 0 1 2.5 12.8V12A4.5 4.5 0 0 1 7 7.5z" />
      <path d="M7.5 10v3.5M5.75 11.75h3.5" />
      <circle cx="15.75" cy="10.75" r=".5" />
      <circle cx="17.75" cy="12.75" r=".5" />
    </>
  ),
};

interface EventIconProps {
  name: EventIconName;
  size?: number;
  className?: string;
}

export function EventIcon({ name, size = 24, className }: EventIconProps) {
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
      {eventIconPaths[name]}
    </svg>
  );
}
