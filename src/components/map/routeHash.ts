/** The Route map's address: '#route-map', or '#route-map=<event>' to share the way to an event. */
export const ROUTE_HASH = 'route-map';

/** '#route-map' or '#route-map=viz-craft' → the event to show (or none yet); null for any other address. */
export function parseRouteHash(hash: string): { eventId: string | null } | null {
  const match = /^#route-map(?:=([a-z0-9-]+))?$/.exec(hash);
  return match ? { eventId: match[1] ?? null } : null;
}
