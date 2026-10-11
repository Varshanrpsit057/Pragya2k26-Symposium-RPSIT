/** PRAGYA 2026 runs technical events only. */
export type EventCategory = 'technical';

export type EventIconName = 'prompt' | 'chart' | 'paper' | 'code' | 'quiz';

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
   * Poster image URL (3:4 portrait, src/assets/events/<id>.webp): the circular carousel,
   * the See More window and the poster wall. Without one, those places use the event's icon.
   */
  poster?: string;
  /** The whole artwork, larger (src/assets/events/<id>-large.webp): the event's panel. */
  posterLarge?: string;

  // Optional details. Leave undefined until confirmed; each renders only when set.
  teamSize?: string;
  venue?: string;
  schedule?: string;
  rules?: string[];
  /** e.g. ['1st prize: ₹1,000', …] */
  prizes?: string[];
  chiefGuest?: string;
  /** The student coordinators; an event with coordinators counts as confirmed. */
  coordinators?: Person[];
  /**
   * Teams allowed: participants may enter as a team (each member still pays the event fee).
   * `maxSize` is the most members a team may have; null when the rules give no limit.
   * Missing: an individual event.
   */
  teams?: { maxSize: number | null };
  /**
   * A link that shows the way to the venue (e.g. a Google My Maps pin or a campus map image).
   * Null until it is set: the event's Route map button then says the map is coming.
   */
  routeMap?: string | null;
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
  /** How it works, beyond what the rounds already say. */
  procedure: string[];
  /** Rules beyond the rounds and the procedure. */
  rules: string[];
  judging: string[];
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
  /**
   * The event day's registration desk: from `opensAt` until `closesAt` (IST) only the desk
   * registers, and after `closesAt` all registration is closed. The switch is automatic (the
   * API checks the clock on every request); see src/lib/schedule.ts.
   */
  onsite: {
    opensAt: string | null;
    closesAt: string | null;
    /** Where to go on the day, e.g. 'the registration desk at the main entrance'. */
    desk: string;
  };
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
  /** Google Form to fall back to if this site's own form ever fails. Null hides the offer. */
  fallbackFormUrl: string | null;
  /**
   * Whether the pass is emailed when a registration is approved. Off: students download it
   * themselves from the website (their status link or Student login).
   */
  passByEmail: boolean;
}

/** The help desk students call for any help; its numbers show across the website. */
export interface HelpDesk {
  /** As dialled, with the country code, e.g. '+91 73582 13736'. */
  phones: { label: string; phone: string }[];
  /** Where it is on the day. */
  where: string;
  hours: string;
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
  /** Also named under "Developed by" in the footer. */
  credited?: boolean;
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
  helpDesk: HelpDesk;
  contacts: Person[];
  email: string | null;
  socials: SocialLink[];
}
