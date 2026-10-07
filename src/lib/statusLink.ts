/**
 * A participant's private status link: the site's address with #status=<Registration ID>.<key>.
 * The key (the form's submission id) never leaves the browser in a request URL: it sits
 * after the #, which browsers do not send to the server or in the Referer header.
 */
import type { OwnRegistration } from './registrationClient';

const STATUS_HASH = /^#status=(PRG26-\d{4,6})\.([A-Za-z0-9_-]{32,64})$/;

export const statusHash = ({ registrationId, key }: OwnRegistration) => `#status=${registrationId}.${key}`;

export function parseStatusHash(hash: string): OwnRegistration | null {
  const match = STATUS_HASH.exec(hash);
  return match ? { registrationId: match[1], key: match[2] } : null;
}

/** The full link, for the participant to keep. */
export const statusLink = (own: OwnRegistration) =>
  `${window.location.origin}${window.location.pathname}${statusHash(own)}`;
