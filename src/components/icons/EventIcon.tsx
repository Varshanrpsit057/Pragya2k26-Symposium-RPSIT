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
