import { crew } from '../../content/crew';
import { site } from '../../content/site';
import { ContactIcon } from '../icons/ContactIcon';
import { IncognitoIcon } from '../icons/IncognitoIcon';
import { SocialIcon } from '../icons/SocialIcon';
import { useSiteModals } from '../modal/siteModalsContext';
import type { NavItem } from '../nav/PillNav';
import { crewLinkLabel } from './DevCrew';
import './Footer.css';

interface FooterProps {
  links: readonly NavItem[];
}

export const CONTACT_PENDING_MESSAGE = 'Symposium coordinators will be announced soon.';

/** '93449 72274' → 'tel:+919344972274' */
const telHref = (number: string) => `tel:+91${number.replace(/\D/g, '')}`;

/** 'https://www.rpsit.ac.in/' → 'www.rpsit.ac.in' */
const displayUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function Footer({ links }: FooterProps) {
  const { college } = site;
  const hasContacts = site.contacts.length > 0 || Boolean(site.email);
  const { openDevCrew } = useSiteModals();

  return (
    <footer id="contact" className="footer" aria-labelledby="contact-title">
      <div className="container footer__grid">
        <div className="footer__brand">
          {/* The college crest, as in the header; the institution is named just below */}
          <img className="footer__logo" src="/images/rpsit-logo-sm.webp" alt="" width="73" height="120" loading="lazy" />
          <p className="footer__wordmark">
            {site.name} <span className="footer__year">{site.year}</span>
          </p>
          <p className="footer__tagline">{site.tagline}</p>
          <p className="footer__institution">{site.institution}</p>

          <ul className="footer__credentials" aria-label="Accreditation">
            {college.credentials.map((credential) => (
              <li key={credential}>{credential}</li>
            ))}
          </ul>

          <div className="footer__credits">
            <div className="footer__credits-head">
              <h2 className="footer__credits-title">Developed by</h2>
              <button
                type="button"
                className="icon-link footer__crew-button"
                aria-label="Meet the Dev Crew"
                title="Meet the Dev Crew"
                aria-haspopup="dialog"
                onClick={openDevCrew}
              >
                <IncognitoIcon size={17} />
              </button>
            </div>
            <ul>
              {crew.map((member) => (
                <li key={member.id}>
                  <span className="footer__credit-person">
                    <span className="footer__credit-name">{member.name}</span>
                    <span className="footer__credit-role">
                      {member.role} · {member.study}
                    </span>
                  </span>
                  <span className="footer__credit-links">
                    {member.links
                      .filter((link) => link.kind !== 'portfolio')
                      .map((link) => (
                        <a
                          key={link.kind}
                          className="icon-link"
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={crewLinkLabel(link.kind, member.name)}
                        >
                          <SocialIcon kind={link.kind} size={15} />
                        </a>
                      ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="footer__contact">
          <h2 id="contact-title" className="footer__heading">
            Contact Us
          </h2>
          <ul className="footer__info">
            <li>
              <ContactIcon name="pin" className="footer__info-icon" />
              <address>
                <strong>{college.name}</strong>
                <span className="footer__status">{college.status}</span>
                {college.address}
              </address>
            </li>
            {college.phones.map((line) => (
              <li key={line.label}>
                <ContactIcon name="phone" className="footer__info-icon" />
                <span>
                  <span className="footer__label">{line.label}</span>
                  {line.numbers.map((number, index) => (
                    <span key={number}>
                      {index > 0 && ', '}
                      <a href={telHref(number)}>+91 {number}</a>
                    </span>
                  ))}
                </span>
              </li>
            ))}
            <li>
              <SocialIcon kind="website" className="footer__info-icon" />
              <a href={college.website} target="_blank" rel="noopener noreferrer">
                {displayUrl(college.website)}
              </a>
            </li>
            {site.email && (
              <li>
                <ContactIcon name="mail" className="footer__info-icon" />
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </li>
            )}
          </ul>

          {hasContacts ? (
            <ul className="footer__people">
              {site.contacts.map((person) => (
                <li key={`${person.name}-${person.phone ?? person.email ?? ''}`}>
                  <span className="footer__person">{person.name}</span>
                  {person.role && <span className="footer__role">{person.role}</span>}
                  {person.phone && (
                    <a href={`tel:${person.phone.replace(/\s+/g, '')}`}>{person.phone}</a>
                  )}
                  {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="footer__pending">{CONTACT_PENDING_MESSAGE}</p>
          )}
        </div>

        <div className="footer__follow">
          {site.socials.length > 0 && (
            <>
              <h2 className="footer__heading">Follow Us</h2>
              <ul className="footer__socials">
                {site.socials.map((social) => (
                  <li key={social.url}>
                    <a
                      className="icon-link"
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${social.label} (opens in a new tab)`}
                    >
                      <SocialIcon kind={social.icon ?? 'website'} />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          <nav className="footer__nav" aria-label="Footer">
            <h2 className="footer__heading">Explore</h2>
            <ul>
              {links.map((link) => (
                <li key={link.id}>
                  <a href={`#${link.id}`}>{link.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="footer__location">
          <h2 className="footer__heading">Location</h2>
          <div className="footer__map">
            <iframe
              src={college.map.embedUrl}
              title={`Map showing ${college.name}`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
          <a
            className="footer__map-link"
            href={college.map.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in Google Maps (opens in a new tab)"
          >
            Open in Google Maps
            <ContactIcon name="external" size={15} />
          </a>
        </div>
      </div>

      <div className="container footer__base">
        <p>
          © {site.year} {site.name}, {site.institution}
        </p>
        <a href="#home" className="footer__top">
          Back to top
        </a>
      </div>

      <p className="footer__echo" aria-hidden="true">
        {site.name}
      </p>
    </footer>
  );
}
