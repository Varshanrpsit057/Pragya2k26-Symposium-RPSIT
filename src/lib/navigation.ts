/**
 * Finding the way on the campus map: from wherever the student is to wherever they want to go
 * (an event venue, a room, the nearest restroom or drinking water, the canteen, mess, main
 * auditorium or an entrance), as the shortest walk through the map's walking network, drawn
 * floor by floor and told in plain steps ("At the corner, turn left. Delta Lab is on your left.").
 * Free of browser APIs, so it is tested like the rest of the logic.
 */
import type { CampusMap, NavNode, Place, RouteLeg } from './campusMap';

export interface RouteStep {
  text: string;
  /** The drawing to show for this step: a floor, or 'campus'. */
  floorId: string;
}

export interface Route {
  nodes: NavNode[];
  legs: RouteLeg[];
  steps: RouteStep[];
  metres: number;
  /** A walk of about this many minutes (with the stairs). */
  minutes: number;
  /** Where it ends: a room (to light up), or a place on the campus. */
  destination: { floorId: string; roomId?: string; label: string };
}

interface Graph {
  nodes: Map<string, NavNode>;
  adjacent: Map<string, { to: string; w: number; say?: string }[]>;
}

const graphs = new WeakMap<CampusMap, Graph>();

function graphOf(map: CampusMap): Graph {
  const cached = graphs.get(map);
  if (cached) return cached;
  const nodes = new Map(map.nav.nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, { to: string; w: number; say?: string }[]>();
  const add = (from: string, to: string, w: number, say?: string) => {
    if (!adjacent.has(from)) adjacent.set(from, []);
    adjacent.get(from)!.push({ to, w, ...(say && { say }) });
  };
  for (const edge of map.nav.edges) {
    add(edge.a, edge.b, edge.w, edge.say ? edge.say[0] || ' ' : undefined);
    add(edge.b, edge.a, edge.w, edge.say ? edge.say[1] || ' ' : undefined);
  }
  const graph = { nodes, adjacent };
  graphs.set(map, graph);
  return graph;
}

/** Shortest paths from one node to every node (Dijkstra; a few hundred nodes). */
function shortest(graph: Graph, from: string) {
  const distance = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, string>();
  const done = new Set<string>();
  const queue = [from];
  while (queue.length) {
    let best = 0;
    for (let index = 1; index < queue.length; index += 1) if (distance.get(queue[index])! < distance.get(queue[best])!) best = index;
    const current = queue.splice(best, 1)[0];
    if (done.has(current)) continue;
    done.add(current);
    for (const { to, w } of graph.adjacent.get(current) ?? []) {
      const next = distance.get(current)! + w;
      if (next < (distance.get(to) ?? Number.POSITIVE_INFINITY)) {
        distance.set(to, next);
        previous.set(to, current);
        queue.push(to);
      }
    }
  }
  return { distance, previous };
}

/** Every place the student can choose: the map's places, the event venues and every room. */
export interface Choice {
  id: string;
  label: string;
  group: string;
}

const roomNodeId = (floorId: string, roomId: string) => `${floorId}:room-${roomId}`;

export function choicesOf(map: CampusMap, venueLabels: Record<string, string> = {}): { from: Choice[]; to: Choice[] } {
  const graph = graphOf(map);
  const campus = map.nav.places.filter((place) => place.group === 'campus').map((place) => ({ id: place.id, label: place.label, group: 'On the campus' }));
  const facilities = map.nav.places.filter((place) => place.group === 'facility').map((place) => ({ id: place.id, label: place.label, group: 'Facilities' }));
  const venues = map.venues.map((venue) => ({ id: `venue:${venue.name}`, label: venueLabels[venue.name] ?? venue.name, group: 'Event venues' }));
  const rooms = map.floors.flatMap((floor) =>
    floor.rooms
      .filter((room) => graph.nodes.has(roomNodeId(floor.id, room.id)))
      .map((room) => ({ id: `room:${floor.id}:${room.id}`, label: room.label, group: floor.name })),
  );
  const fixed = facilities.filter((choice) => !map.nav.places.find((place) => place.id === choice.id)?.nearest);
  return { from: [...campus, ...fixed, ...venues, ...rooms], to: [...venues, ...facilities, ...campus, ...rooms] };
}

/** The choice for an event venue (its name as in the event catalog). */
export const venueChoice = (map: CampusMap, venueName: string | null | undefined) =>
  venueName ? (map.venues.some((venue) => venue.name.toLowerCase() === venueName.toLowerCase()) ? `venue:${map.venues.find((venue) => venue.name.toLowerCase() === venueName.toLowerCase())!.name}` : null) : null;

/** The node(s) a choice stands for; `nearest` places stand for every node with that tag. */
function targetsOf(map: CampusMap, choice: string): string[] {
  const graph = graphOf(map);
  if (choice.startsWith('venue:')) {
    const venue = map.venues.find((item) => item.name === choice.slice(6));
    return venue ? [roomNodeId(venue.floorId, venue.roomId)] : [];
  }
  if (choice.startsWith('room:')) {
    const [, floorId, roomId] = choice.split(':');
    return [roomNodeId(floorId, roomId)];
  }
  const place: Place | undefined = map.nav.places.find((item) => item.id === choice);
  if (!place) return [];
  if (place.node) return [place.node];
  return [...graph.nodes.values()].filter((node) => node.tag === place.nearest).map((node) => node.id);
}

const floorName = (map: CampusMap, floorId: string) => (floorId === 'campus' ? 'campus' : (map.floors.find((floor) => floor.id === floorId)?.name ?? floorId).toLowerCase());
const floorIndex = (map: CampusMap, floorId: string) => map.floors.findIndex((floor) => floor.id === floorId);

const labelOf = (map: CampusMap, node: NavNode) => {
  if (node.label) return node.label;
  if (node.roomId) for (const floor of map.floors) for (const room of floor.rooms) if (room.id === node.roomId) return room.label;
  return '';
};

const WALK_M_PER_MIN = 70;
const SHORT_M = 3;

/** The way from one choice to another, or null when there is none for students. */
export function findRoute(map: CampusMap, from: string, to: string): Route | null {
  const graph = graphOf(map);
  const [start] = targetsOf(map, from);
  const ends = targetsOf(map, to);
  if (!start || !ends.length || !graph.nodes.has(start)) return null;
  const { distance, previous } = shortest(graph, start);
  const reachable = ends.filter((id) => distance.has(id));
  if (!reachable.length) return null;
  const end = reachable.reduce((best, id) => (distance.get(id)! < distance.get(best)! ? id : best));
  const ids = [end];
  while (ids[0] !== start) ids.unshift(previous.get(ids[0])!);
  const nodes = ids.map((id) => graph.nodes.get(id)!);

  // The legs: one per drawing, split where the walk changes floor or goes in or out.
  const legs: RouteLeg[] = [];
  for (const node of nodes) {
    const last = legs[legs.length - 1];
    if (last && last.floorId === node.floorId) last.points.push([node.x, node.y]);
    else legs.push({ floorId: node.floorId, points: [[node.x, node.y]] });
  }
  const stairsTotal = nodes.slice(1).filter((node, index) => node.kind === 'stairs' && nodes[index].kind === 'stairs' && node.floorId !== nodes[index].floorId).length;
  const metres = distance.get(end)!;
  const endNode = graph.nodes.get(end)!;
  return {
    nodes,
    legs: legs.filter((leg) => leg.points.length > 1),
    steps: describe(map, graph, nodes),
    metres: Math.round(metres),
    minutes: Math.max(1, Math.round(metres / WALK_M_PER_MIN + stairsTotal * 0.3)),
    destination: { floorId: endNode.floorId, ...(endNode.roomId && { roomId: endNode.roomId }), label: labelOf(map, endNode) },
  };
}

type Vector = [number, number];
const minus = (a: NavNode, b: NavNode): Vector => [a.x - b.x, a.y - b.y];
const lengthOf = ([x, y]: Vector) => Math.hypot(x, y);
/** > 0: `b` is to the right of heading `a` (the drawings' y runs down). */
const cross = ([ax, ay]: Vector, [bx, by]: Vector) => ax * by - ay * bx;
const sideOf = (heading: Vector, offset: Vector) => (cross(heading, offset) > 0 ? 'right' : 'left');
/** Ahead, behind, left or right of the heading (within 30° counts as ahead or behind). */
const directionOf = (heading: Vector, offset: Vector) => {
  const sin = cross(heading, offset) / (lengthOf(heading) * lengthOf(offset) || 1);
  if (Math.abs(sin) >= 0.5) return sin > 0 ? 'right' : 'left';
  return heading[0] * offset[0] + heading[1] * offset[1] >= 0 ? 'ahead' : 'behind';
};
const TURN = { left: 'Turn left and walk', right: 'Turn right and walk', ahead: 'Walk on', behind: 'Turn round and walk' } as const;

/** Plain steps for the walk. */
function describe(map: CampusMap, graph: Graph, nodes: NavNode[]): RouteStep[] {
  const steps: RouteStep[] = [];
  const push = (text: string, floorId: string) => {
    if (text.trim() && steps[steps.length - 1]?.text !== text) steps.push({ text, floorId });
  };
  const court = map.plan.court;
  const courtCentre = { x: court.x + court.w / 2, y: court.y + court.h / 2 };
  const edgeSay = (a: NavNode, b: NavNode) => graph.adjacent.get(a.id)?.find((edge) => edge.to === b.id)?.say;

  if (nodes.length === 1) {
    push('You are already there.', nodes[0].floorId);
    return steps;
  }
  const first = nodes[0];
  if (first.kind === 'door') push(`Come out of ${labelOf(map, first)}.`, first.floorId);

  let index = 0;
  while (index < nodes.length - 1) {
    const a = nodes[index];
    const b = nodes[index + 1];
    // The stairs, possibly several floors at once.
    if (a.kind === 'stairs' && b.kind === 'stairs' && a.floorId !== b.floorId) {
      let last = index + 1;
      while (last + 1 < nodes.length && nodes[last + 1].kind === 'stairs' && nodes[last + 1].floorId !== nodes[last].floorId) last += 1;
      const target = nodes[last];
      const up = floorIndex(map, target.floorId) > floorIndex(map, a.floorId);
      push(`Take ${a.name ?? 'the stairs'} ${up ? 'up' : 'down'} to the ${floorName(map, target.floorId)}.`, target.floorId);
      index = last;
      continue;
    }
    const say = edgeSay(a, b);
    if (say) {
      // '{side}' and '{Turn}': worked out from the way the student is walking (it differs coming from each end).
      const before = nodes[index - 1];
      const direction = before && before.floorId === a.floorId ? directionOf(minus(a, before), minus(b, a)) : null;
      const text = say
        .replace(' on your {side}', direction === 'left' || direction === 'right' ? ` on your ${direction}` : ' straight ahead')
        .replace('{Turn}', direction ? TURN[direction] : 'Walk');
      push(text, b.floorId === 'campus' ? 'campus' : a.floorId === 'campus' ? 'campus' : b.floorId);
      index += 1;
      continue;
    }
    if (a.floorId !== b.floorId) {
      // The same spot in two drawings (an entrance seen from the campus and from inside).
      index += 1;
      continue;
    }
    // A walk on one floor: through to the next stairs, entrance, or the end.
    let last = index + 1;
    while (last + 1 < nodes.length && nodes[last + 1].floorId === a.floorId && !edgeSay(nodes[last], nodes[last + 1]) && !(nodes[last].kind === 'stairs' && nodes[last + 1].kind === 'stairs')) last += 1;
    walkSteps(map, nodes.slice(index, last + 1), courtCentre, push, index === 0 && first.kind !== 'door', nodes[index - 1]);
    index = last;
  }
  return steps;
}

/** One floor's walk: straight runs, the turns between them, and which side the destination is on. */
function walkSteps(
  map: CampusMap,
  walk: NavNode[],
  courtCentre: { x: number; y: number },
  push: (text: string, floorId: string) => void,
  atStart: boolean,
  cameFrom: NavNode | undefined,
) {
  const floorId = walk[0].floorId;
  let points = walk;
  // Out of a room: its door faces the corridor, so the first move is a turn along it.
  let leadIn: Vector | null = null;
  if (points[0].kind === 'door' && points.length > 1) {
    leadIn = minus(points[1], points[0]);
    points = points.slice(1);
  }
  const end = points[points.length - 1];
  const toDoor = end.kind === 'door' || end.kind === 'water';
  const body = toDoor ? points.slice(0, -1) : points;

  const runs: { from: NavNode; to: NavNode; heading: Vector; ring: boolean; corner: boolean }[] = [];
  for (let index = 0; index < body.length - 1; index += 1) {
    const from = body[index];
    const to = body[index + 1];
    const heading = minus(to, from);
    const ring = from.kind === 'corridor' && to.kind === 'corridor';
    const previous = runs[runs.length - 1];
    const straight = previous && Math.abs(cross(previous.heading, heading)) <= 0.02 * lengthOf(previous.heading) * lengthOf(heading);
    if (previous && (straight || ((lengthOf(heading) / 80) * 9.144 < SHORT_M && ring === previous.ring))) {
      previous.to = to;
      previous.heading = minus(to, previous.from);
      continue;
    }
    runs.push({ from, to, heading, ring, corner: Boolean(from.corner) });
  }
  const courtSide = (run: (typeof runs)[number]) => (run.ring ? `, with the courtyard on your ${sideOf(run.heading, [courtCentre.x - run.from.x, courtCentre.y - run.from.y])}` : '');
  const turnWord = (before: Vector, after: Vector) => sideOf(before, after);
  const opening = cameFrom?.kind === 'stairs' ? 'From the stairs, walk' : cameFrom?.kind === 'outside' ? 'Inside, walk' : 'Walk';
  void atStart;

  const firstRing = runs.findIndex((run) => run.ring);
  const nearby = runs.reduce((sum, run) => sum + (lengthOf(run.heading) / 80) * 9.144, 0) < 15;
  if (firstRing === -1 && nearby && (end.kind === 'stairs' || end.kind === 'entrance')) {
    // A few steps to the stairs or the door: no turns to follow.
    if (end.kind === 'stairs' && end.name) push(`${end.name.charAt(0).toUpperCase()}${end.name.slice(1)} are right there.`, floorId);
  } else if (firstRing === -1) {
    // No corridor on the way (a hallway, the stairs, or outside).
    runs.forEach((run, index) => {
      if (index === 0) push(leadIn ? `Turn ${turnWord(leadIn, run.heading)}.` : `${opening} ahead.`, floorId);
      else push(`Then, turn ${turnWord(runs[index - 1].heading, run.heading)}${run.to.kind === 'outside' ? ', out of the building' : ''}.`, floorId);
    });
  } else {
    let lastRing = firstRing;
    runs.forEach((run, index) => {
      if (run.ring) lastRing = index;
    });
    const lead = runs.slice(0, firstRing);
    const first = runs[firstRing];
    const before = lead.length ? lead[lead.length - 1].heading : leadIn;
    if (leadIn && !lead.length) push(`Turn ${turnWord(leadIn, first.heading)} along the corridor${courtSide(first)}.`, floorId);
    else if (before) push(`${opening} out to the corridor, then turn ${turnWord(before, first.heading)} along it${courtSide(first)}.`, floorId);
    else push(`${opening} along the corridor${courtSide(first)}.`, floorId);
    for (let index = firstRing + 1; index <= lastRing; index += 1) {
      const run = runs[index];
      const where = run.from.corner ? 'At the corner' : 'Then';
      push(`${where}, turn ${turnWord(runs[index - 1].heading, run.heading)}${run.ring ? ` along the corridor${courtSide(run)}` : ''}.`, floorId);
    }
    const trail = runs.slice(lastRing + 1);
    if (end.kind === 'stairs' || end.kind === 'entrance') {
      if (trail.length) push(`Then go on to ${end.name ?? 'the end of the corridor'}.`, floorId);
    } else {
      trail.forEach((run, index) => {
        const previous = index === 0 ? runs[lastRing].heading : trail[index - 1].heading;
        push(`Then, turn ${turnWord(previous, run.heading)}${run.to.kind === 'outside' || run.to.kind === 'hallway' ? (run.to.kind === 'outside' ? ', out of the building' : ' into the hallway') : ''}.`, floorId);
      });
    }
  }
  if (toDoor) {
    const before = body[body.length - 1];
    const heading = runs.length ? runs[runs.length - 1].heading : (leadIn ?? minus(end, before));
    const offset = minus(end, before);
    const ahead = Math.abs(cross(heading, offset)) < 0.35 * lengthOf(heading) * lengthOf(offset);
    const name = labelOf(map, end) || 'It';
    push(ahead ? `${name} is ahead of you.` : `${name} is on your ${sideOf(heading, offset)}.`, floorId);
  }
}
