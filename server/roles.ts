/**
 * Server-side authorization for staff. The dashboard hides what a role cannot use, but only
 * these checks decide: every staff route names the permission it needs, and every event
 * action checks that the event is one the account may touch.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import { EVENT_SCOPED_ROLES, ROLE_INFO, hasPermission, type Permission, type StaffRole } from '../src/lib/staff';
import { ApiError } from './errors';

/** The signed-in staff member, read fresh from their account on every request. */
export interface Actor {
  username: string;
  displayName: string;
  role: StaffRole;
  /** Assigned events (coordinators); empty for roles that see every event. */
  eventIds: string[];
  kind: 'owner' | 'staff';
  expiresAt: number;
  /** The registration desk this sign-in is at (desk accounts); null otherwise. */
  deskNumber: number | null;
  /** The department (department roles); null for roles that see every department. */
  department: string | null;
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) {
    throw new ApiError(403, 'FORBIDDEN', `Your role (${ROLE_INFO[actor.role]?.label ?? actor.role}) cannot do this.`);
  }
}

/** Any one of the permissions is enough (e.g. a roster is for coordinators and the certificate team). */
export function requireAnyPermission(actor: Actor, permissions: readonly Permission[]): void {
  if (!permissions.some((permission) => hasPermission(actor.role, permission))) {
    throw new ApiError(403, 'FORBIDDEN', `Your role (${ROLE_INFO[actor.role]?.label ?? actor.role}) cannot do this.`);
  }
}

export const isKnownEvent = (eventId: string) => eventCatalog.some((event) => event.id === eventId);

/** Whether the account may see or work on this event (coordinators: only their own). */
export function canAccessEvent(actor: Actor, eventId: string): boolean {
  if (!isKnownEvent(eventId)) return false;
  return !EVENT_SCOPED_ROLES.includes(actor.role) || actor.eventIds.includes(eventId);
}

/**
 * The event, if it exists and the account may use it with this permission. An unknown event
 * is 404; an event that is not assigned to a coordinator is 403, with no detail about it.
 */
export function requireEvent(actor: Actor, eventId: string, permission: Permission) {
  const event = eventCatalog.find((item) => item.id === eventId);
  if (!event) throw new ApiError(404, 'NOT_FOUND', 'There is no such event.');
  requirePermission(actor, permission);
  if (!canAccessEvent(actor, eventId)) {
    throw new ApiError(403, 'EVENT_NOT_ASSIGNED', 'This event is not assigned to your account.');
  }
  return event;
}

/** The events an account may see, in the site's order. */
export const visibleEvents = (actor: Actor) => eventCatalog.filter((event) => canAccessEvent(actor, event.id));
