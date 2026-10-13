import type { CrewLinkKind } from '../../content/types';

const LINK_NAMES: Record<CrewLinkKind, (name: string) => string> = {
  linkedin: (name) => `${name} on LinkedIn`,
  github: (name) => `${name} on GitHub`,
  portfolio: (name) => `Portfolio of ${name}`,
};

/**
 * Accessible name for a crew profile link, e.g. "Varshan C on GitHub (opens in a new tab)". On its
 * own, so the footer uses it without loading the Dev Crew window's code and styles.
 */
export function crewLinkLabel(kind: CrewLinkKind, name: string): string {
  return `${LINK_NAMES[kind](name)} (opens in a new tab)`;
}
