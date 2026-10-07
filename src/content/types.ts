export type EventCategory = 'technical' | 'non-technical';

export type EventIconName =
  | 'prompt'
  | 'chart'
  | 'paper'
  | 'code'
  | 'quiz'
  | 'vector'
  | 'film'
  | 'eye'
  | 'tag'
  | 'gamepad';

export interface Person {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
}

export interface SymposiumEvent {
  /** URL-safe id, used for anchors such as #event-code-flex. */
  id: string;
  name: string;
  subtitle?: string;
  category: EventCategory;
  description: string;
  icon: EventIconName;
  /**
   * Poster image URL (3:4 portrait), imported from src/assets/events.
   * Shown as the showcase card, the event card banner and a drift-wall tile.
   * Without one, those places fall back to the event's icon.
   */
  poster?: string;

  // Optional details. Leave undefined until confirmed; each renders only when set.
  teamSize?: string;
  venue?: string;
  schedule?: string;
  rules?: string[];
  coordinators?: Person[];
}

export interface EventRound {
  name: string;
  detail: string;
}

/** Everything the See More window shows for an event. */
export interface EventInfo {
  /** e.g. 'Technical · Team event' */
  type: string;
  team: string;
  rounds: EventRound[];
  procedure: string[];
  rules: string[];
  judging: string[];
  instructions: string[];
}

export interface RegistrationSettings {
  /**
   * The registration API's route, /api/register (on the API address from the Amplify
   * build). Null turns online registration off (the form says it is not connected yet).
   */
  endpoint: string | null;
  /**
   * When registration closes: '2026-10-16T17:00:00' is read as IST (or add an offset).
   * The hero counts down to it; after it, the countdown, the Register section and the
   * form all say registration is closed. Null: no countdown, never closes.
   */
  closesAt: string | null;
  deadline: string | null;
  note: string | null;
  /** Gate pass fee per person, paid online with registration (₹). */
  gatePassFee: number;
  /** Fee per event, paid on-site (₹). */
  eventFee: number;
  payment: {
    upiId: string | null;
    payee: string | null;
    /** URL of a UPI QR code image, e.g. '/images/upi-qr.png' in public/. */
    qrImage: string | null;
  };
}

export type CrewLinkKind = 'linkedin' | 'github' | 'portfolio';

/** Icons available for profile and social links. */
export type SocialIconName = CrewLinkKind | 'instagram' | 'website';

export interface SocialLink {
  label: string;
  url: string;
  /** Defaults to the website globe. */
  icon?: SocialIconName;
}

export interface PhoneLine {
  label: string;
  /** As displayed, without the country code, e.g. '93449 72274'. */
  numbers: string[];
}

/** The host college, shown in the footer. */
export interface College {
  name: string;
  /** Shown under the name, e.g. 'An Autonomous Institution'. */
  status: string;
  address: string;
  phones: PhoneLine[];
  website: string;
  /** Short accreditation facts, shown as tags. */
  credentials: string[];
  map: {
    /** The full Google Maps page, opened in a new tab. */
    url: string;
    /** The embeddable map shown in the footer (Google Maps → Share → Embed a map). */
    embedUrl: string;
  };
}

export interface CrewLink {
  kind: CrewLinkKind;
  url: string;
}

export interface CrewMember {
  /** URL-safe id; also the portrait's file name in src/assets/crew/. */
  id: string;
  name: string;
  /** e.g. 'Frontend Developer' */
  role: string;
  /** Year and department, e.g. 'III Year – AI&DS' */
  study: string;
  /** Portrait URL (square). Without one, the card shows the member's initials. */
  photo?: string;
  links: CrewLink[];
}

export interface SiteInfo {
  name: string;
  year: string;
  institution: string;
  /** The host department, shown above the wordmark in the hero. */
  department: string;
  tagline: string;
  college: College;

  // Optional details. Leave as null / empty until confirmed; each renders only when set.
  dates: string | null;
  venue: string | null;
  registration: RegistrationSettings;
  contacts: Person[];
  email: string | null;
  socials: SocialLink[];
}
