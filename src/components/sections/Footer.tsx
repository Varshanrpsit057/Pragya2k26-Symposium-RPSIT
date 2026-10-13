import { CollegeLockup } from '../CollegeLockup';
import { crew } from '../../content/crew';
import { site } from '../../content/site';
import { HelpDeskLine } from '../help/HelpDeskLine';
import { ContactIcon } from '../icons/ContactIcon';
import { SocialIcon } from '../icons/SocialIcon';
import { crewLinkLabel } from './DevCrew';
import './Footer.css';

/** A link under Explore: another page, or a section (#id) of this page. */
export interface FooterLink {
  id: string;
  label: string;
  href?: string;
}

interface FooterProps {
  links: readonly FooterLink[];
}

/** '93449 72274' → 'tel:+919344972274' */
const telHref = (number: string) => `tel:+91${number.replace(/\D/g, '')}`;

/** 'https://www.rpsit.ac.in/' → 'www.rpsit.ac.in' */
const displayUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * Brand and contact on top; below them the credits, follow and explore links, side by side
 * with the map. The whole Dev Crew opens from the incognito button in the navigation.
 */
export function Footer({ links }: FooterProps) {
  const { college } = site;
  const credited = crew.filter((member) => member.credited);

  return (
    <footer id="contact" className="footer" aria-labelledby="contact-title">
      <div className="container footer__grid">
        <div className="footer__brand">
          {/* The college's lockup, as in the header */}
          <CollegeLockup className="footer__college" loading="lazy" />
          {/* The fest's name, as in the hero (site.name, PRAGYA, stays on the passes, emails and reports) */}
          <p className="footer__wordmark">
            Infinite Techfest<span className="footer__year">’26</span>
          </p>
          <p className="footer__tagline">{site.tagline}</p>

          <ul className="footer__credentials" aria-label="Accreditation">
            {college.credentials.map((credential) => (
              <li key={credential}>{credential}</li>
            ))}
          </ul>
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

          <div className="footer__helpdesk">
            <h3 className="footer__subheading">Help desk</h3>
            <HelpDeskLine lead="Call for any help" />
          </div>
        </div>

        <div className="footer__more">
          {credited.length > 0 && (
            <div className="footer__credits">
              <h2 className="footer__heading">Developed by</h2>
              <ul>
                {credited.map((member) => (
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
          )}

          <div className="footer__columns">
            {site.socials.length > 0 && (
              <div>
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
              </div>
            )}

            <nav className="footer__nav" aria-label="Footer">
              <h2 className="footer__heading">Explore</h2>
              <ul>
                {links.map((link) => (
                  <li key={link.id}>
                    <a href={link.href ?? `#${link.id}`}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
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
          © {site.year} Infinite Techfest, {site.institution}
        </p>
        <a href="#home" className="footer__top">
          Back to top
        </a>
      </div>

      <p className="footer__echo" aria-hidden="true">
        Infinite
      </p>
    </footer>
  );
}
