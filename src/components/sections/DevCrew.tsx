import { crew } from '../../content/crew';
import type { CrewLinkKind, CrewMember } from '../../content/types';
import { IncognitoIcon } from '../icons/IncognitoIcon';
import { SocialIcon } from '../icons/SocialIcon';
import { Modal } from '../modal/Modal';
import ProfileCard from '../profile/ProfileCard';
import './DevCrew.css';

const LINK_NAMES: Record<CrewLinkKind, (name: string) => string> = {
  linkedin: (name) => `${name} on LinkedIn`,
  github: (name) => `${name} on GitHub`,
  portfolio: (name) => `Portfolio of ${name}`,
};

/** Accessible name for a crew profile link, e.g. "Varshan C on GitHub (opens in a new tab)". */
export function crewLinkLabel(kind: CrewLinkKind, name: string): string {
  return `${LINK_NAMES[kind](name)} (opens in a new tab)`;
}

/** "Mohan Prabu K" → "MP": shown in place of a portrait until one is added. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/** The GitHub username, shown as the card's handle. */
function handleOf(member: CrewMember): string {
  const github = member.links.find((link) => link.kind === 'github');
  return github ? new URL(github.url).pathname.replace(/^\/|\/$/g, '') : member.id;
}

/** The card gradient from the React Bits usage example. */
const INNER_GRADIENT = 'linear-gradient(145deg,#60496e8c 0%,#71C4FF44 100%)';

/**
 * The developers who built the site, on React Bits' Profile Card, in a window opened from
 * the incognito button beside "Developed by" in the footer. Each photo keeps its own
 * background; the cards are static and only load when the window opens.
 */
export function DevCrewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="dev-crew-title" className="dev-crew-modal">
      <div className="dev-crew">
        <header className="dev-crew__head">
          <span className="dev-crew__mark" aria-hidden="true">
            <IncognitoIcon size={26} />
          </span>
          <h2 id="dev-crew-title" className="section-title">
            Dev Crew
          </h2>
          <p className="section-lead">The team behind the digital experience.</p>
        </header>

        <ul className="crew-grid">
          {crew.map((member) => (
            <li key={member.id}>
              <article className="crew-member" aria-label={`${member.name}, ${member.role}, ${member.study}`}>
                <ProfileCard
                  name={member.name}
                  title={member.role}
                  handle={handleOf(member)}
                  status={member.study}
                  avatarUrl={member.photo}
                  innerGradient={INNER_GRADIENT}
                  interactive={false}
                  fallback={
                    <span className="crew-member__initials" aria-hidden="true">
                      {initials(member.name)}
                    </span>
                  }
                  actions={member.links.map((link) => (
                    <a
                      key={link.kind}
                      className="icon-link"
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={crewLinkLabel(link.kind, member.name)}
                    >
                      <SocialIcon kind={link.kind} size={16} />
                    </a>
                  ))}
                />
              </article>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
