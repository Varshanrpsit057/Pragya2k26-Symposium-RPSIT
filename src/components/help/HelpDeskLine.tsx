import { site } from '../../content/site';
import './HelpDesk.css';

/** '+91 73582 13736' → 'tel:+917358213736' */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
/** '+91 73582 13736' → 'https://wa.me/917358213736' */
export const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

/**
 * The help desk's numbers in one line, for every place a student may need help: the event
 * windows, the registration and status windows, the footer and the student page.
 */
export function HelpDeskLine({ lead = 'Need help? Call the help desk' }: { lead?: string }) {
  const { phones } = site.helpDesk;
  if (!phones.length) return null;
  return (
    <p className="help-line">
      <span className="help-line__lead">{lead}:</span>{' '}
      {phones.map((line, index) => (
        <span key={line.phone} className="help-line__number">
          {index > 0 && ' · '}
          <a href={telHref(line.phone)}>{line.phone}</a>{' '}
          <a className="help-line__wa" href={whatsappHref(line.phone)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp the help desk on ${line.phone}`}>
            WhatsApp
          </a>
        </span>
      ))}
    </p>
  );
}
