/** Hat and glasses: the "incognito" mark that opens the Dev Crew. Decorative; label the button. */
export function IncognitoIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.3 4.7a1.2 1.2 0 0 1 1.5-.8l3.2 1.1 3.2-1.1a1.2 1.2 0 0 1 1.5.8L18.3 10H5.7z" fill="currentColor" />
      <rect x="2" y="10.3" width="20" height="2.1" rx="1.05" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="7.3" cy="16.8" r="2.9" />
        <circle cx="16.7" cy="16.8" r="2.9" />
        <path d="M10.3 16.4c1.1-.7 2.3-.7 3.4 0" />
      </g>
    </svg>
  );
}
