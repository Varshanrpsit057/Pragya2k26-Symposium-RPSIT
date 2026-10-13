import { site } from '../content/site';
import './CollegeLockup.css';

interface CollegeLockupProps {
  className?: string;
  loading?: 'eager' | 'lazy';
}

/**
 * The college's own lockup, as on rpsit.ac.in: the whole oval crest (transparent outside the
 * oval), the name, and "An Autonomous Institution" spaced out in capitals beneath it.
 */
export function CollegeLockup({ className, loading = 'eager' }: CollegeLockupProps) {
  return (
    <span className={className ? `college-lockup ${className}` : 'college-lockup'}>
      <img className="college-lockup__crest" src="/images/rpsit-crest.webp" alt="" width="153" height="240" loading={loading} />
      <span className="college-lockup__text">
        <strong className="college-lockup__name">{site.college.name}</strong>
        <span className="college-lockup__status">{site.college.status}</span>
      </span>
    </span>
  );
}
