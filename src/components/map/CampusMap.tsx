/**
 * The campus map for students: the way from the outer gate to the main building, and each floor
 * of the main building with the venue lit up, the way there drawn on the plan, step-by-step
 * directions, and photo dots that show the picture taken from that spot ("you are here").
 * Plain SVG: no map service, and the photos load only when a dot is tapped, so it is light on
 * the campus network. The main entrance is at the bottom, as students see the building.
 */
import { useId, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  CAMPUS,
  ROOM_KINDS,
  photoUrl,
  venueOf,
  type BuildingPlan,
  type CampusMap as CampusMapData,
  type Floor,
  type Mark,
  type PhotoSpot,
  type Room,
  type RouteLeg,
  type Venue,
} from '../../lib/campusMap';
import './CampusMap.css';

/** About how wide `text` is at `size` px in the plan's semibold sans (no DOM needed, so it also runs in tests). */
function textWidth(text: string, size: number) {
  let em = 0;
  for (const ch of text) {
    if (/[A-Z]/.test(ch)) em += /[IJ]/.test(ch) ? 0.32 : /[MW]/.test(ch) ? 0.86 : 0.68;
    else if (/[a-z]/.test(ch)) em += /[ijl]/.test(ch) ? 0.26 : /[ft]/.test(ch) ? 0.36 : /[mw]/.test(ch) ? 0.84 : 0.55;
    else if (/[0-9]/.test(ch)) em += 0.58;
    else em += ch === ' ' ? 0.28 : 0.4;
  }
  return em * size * 1.04;
}

/** Greedy word wrap to `room` pixels wide. */
function wrap(label: string, room: number, size: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of label.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > room) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Fits a room's name in its box: the largest text that fits, turned sideways in a narrow tall room. */
export function fitLabel(label: string, w: number, h: number): { lines: string[]; size: number; vertical: boolean } {
  const vertical = w < 46 && h > w * 1.4;
  const [across, along] = vertical ? [h, w] : [w, h];
  const room = across - 8;
  for (const size of [14, 13, 12, 11, 10, 9]) {
    const maxLines = Math.max(1, Math.min(4, Math.floor((along - 6) / (size * 1.15))));
    const lines = wrap(label, room, size);
    if (lines.length <= maxLines && lines.every((line) => textWidth(line, size) <= room)) return { lines, size, vertical };
  }
  const maxLines = Math.max(1, Math.min(4, Math.floor((along - 6) / 10.5)));
  const lines = wrap(label, room, 9).slice(0, maxLines);
  const cut = (line: string) => {
    while (line.length > 1 && textWidth(`${line}…`, 9) > room) line = line.slice(0, -1);
    return `${line}…`;
  };
  return { lines: lines.map((line) => (textWidth(line, 9) > room ? cut(line) : line)), size: 9, vertical };
}

const activate = (handler: () => void) => ({
  onClick: (event: MouseEvent) => {
    event.stopPropagation();
    handler();
  },
  onKeyDown: (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  },
});

const points = (list: [number, number][]) => list.map(([x, y]) => `${x},${y}`).join(' ');

function roomClass(room: Room, isVenue: boolean, isSelected = false) {
  return `map-room map-room--${room.kind}${isVenue ? ' is-venue' : ''}${isSelected ? ' is-selected' : ''}`;
}

function RoomBox({ room, isVenue, isSelected, onRoom }: { room: Room; isVenue: boolean; isSelected: boolean; onRoom?: (room: Room) => void }) {
  return (
    <g
      className={roomClass(room, isVenue, isSelected)}
      {...(onRoom && { role: 'button', tabIndex: 0, 'aria-label': `${room.label} (${ROOM_KINDS[room.kind]})`, ...activate(() => onRoom(room)) })}
    >
      <title>{`${room.label} · ${ROOM_KINDS[room.kind]}`}</title>
      <rect x={room.x + 2} y={room.y + 2} width={Math.max(room.w - 4, 1)} height={Math.max(room.h - 4, 1)} rx="5" />
    </g>
  );
}

function RoomLabel({ room, isVenue }: { room: Room; isVenue: boolean }) {
  const { lines, size, vertical } = fitLabel(room.label, room.w, room.h);
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  return (
    <g className={roomClass(room, isVenue)}>
      <text transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined} style={{ fontSize: size }}>
        {lines.map((line, index) => (
          <tspan key={`${index}-${line}`} x={cx} y={cy + (index - (lines.length - 1) / 2) * size * 1.15 + size * 0.36}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

/** An arrow of `length` pointing `dir`, its tip at (x, y). */
function arrowPath(x: number, y: number, dir: 'left' | 'right' | 'up' | 'down', length = 40) {
  const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  const [tx, ty] = [x - dx * length, y - dy * length];
  const [px, py] = [-dy, dx];
  return `M${tx} ${ty} L${x} ${y} M${x - dx * 12 + px * 9} ${y - dy * 12 + py * 9} L${x} ${y} L${x - dx * 12 - px * 9} ${y - dy * 12 - py * 9}`;
}

function MarkShape({ mark }: { mark: Mark }) {
  switch (mark.kind) {
    case 'water':
      return (
        <g className="map-mark map-mark--water">
          <title>{mark.label}</title>
          <circle cx={mark.x} cy={mark.y} r="10" />
          <path d={`M${mark.x} ${mark.y - 6} C${mark.x + 4} ${mark.y - 1} ${mark.x + 5} ${mark.y + 2} ${mark.x} ${mark.y + 6} C${mark.x - 5} ${mark.y + 2} ${mark.x - 4} ${mark.y - 1} ${mark.x} ${mark.y - 6}Z`} />
        </g>
      );
    case 'glass-door':
      return (
        <g className="map-mark map-mark--glass">
          <title>{`${mark.label}: closed to students`}</title>
          <line x1={mark.x} y1={mark.y} x2={mark.x2} y2={mark.y2} />
          <text x={(mark.x + mark.x2) / 2} y={Math.max(mark.y, mark.y2) + 16}>
            {mark.label}
          </text>
        </g>
      );
    case 'entrance': {
      // Points in from outside, its tip on the wall; the name sits beyond the tail (above it for a side door).
      const across = mark.dir === 'left' || mark.dir === 'right';
      const at = across
        ? { x: mark.dir === 'right' ? 6 : mark.x + 6, y: mark.y - 12, anchor: 'start' as const }
        : { x: mark.x + 14, y: mark.dir === 'up' ? mark.y + 40 : mark.y - 30, anchor: 'start' as const };
      return (
        <g className="map-mark map-mark--entrance">
          <path d={arrowPath(mark.x, mark.y, mark.dir)} />
          <text x={at.x} y={at.y} style={{ textAnchor: at.anchor }}>
            {mark.label}
          </text>
        </g>
      );
    }
    case 'exit': {
      const [first, second] = mark.points;
      const last = mark.points[mark.points.length - 1];
      const prev = mark.points[mark.points.length - 2];
      const dir = last[0] > prev[0] ? 'right' : last[0] < prev[0] ? 'left' : last[1] < prev[1] ? 'up' : 'down';
      return (
        <g className="map-mark map-mark--exit">
          <title>{mark.label}</title>
          <polyline points={points(mark.points)} />
          <path d={arrowPath(last[0], last[1], dir, 1)} />
          <text x={(first[0] + second[0]) / 2} y={Math.max(first[1], second[1]) + 18}>
            {mark.label}
          </text>
        </g>
      );
    }
    case 'closed': {
      // A stub out of the wall ending in a cross: there is a way here, but it is shut.
      const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[mark.dir];
      const [ex, ey] = [mark.x + dx * 24, mark.y + dy * 24];
      const [first, ...rest] = mark.label.split(' (');
      const lines = rest.length ? [first, `(${rest.join(' (')}`] : [first];
      const lx = ex + dx * 14;
      return (
        <g className="map-mark map-mark--closed">
          <title>{mark.label}</title>
          <line x1={mark.x} y1={mark.y} x2={ex} y2={ey} />
          <path d={`M${ex - 6} ${ey - 6} L${ex + 6} ${ey + 6} M${ex + 6} ${ey - 6} L${ex - 6} ${ey + 6}`} />
          <text style={{ textAnchor: dx < 0 ? 'end' : dx > 0 ? 'start' : 'middle' }}>
            {lines.map((line, index) => (
              <tspan key={line} x={lx} y={ey + (dy || 0) * 22 + (index - (lines.length - 1) / 2) * 14 + 4}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      );
    }
    case 'outside':
      return (
        <g className="map-mark map-mark--outside">
          <rect x={mark.x} y={mark.y} width={mark.w} height={mark.h} rx="6" />
          <text x={mark.x + mark.w / 2} y={mark.y + mark.h / 2 + 5}>
            {mark.label}
          </text>
        </g>
      );
  }
}

function Route({ leg, marker }: { leg: RouteLeg; marker: string }) {
  if (leg.points.length < 2) return null;
  const [start] = leg.points;
  const end = leg.points[leg.points.length - 1];
  return (
    <g className="map-route" aria-hidden="true">
      <polyline className="map-route__casing" points={points(leg.points)} />
      <polyline className="map-route__line" points={points(leg.points)} markerEnd={`url(#${marker})`} />
      <circle className="map-route__start" cx={start[0]} cy={start[1]} r="7" />
      {leg.from && (
        <text className="map-route__label" x={leg.fromAt?.[0] ?? start[0]} y={leg.fromAt?.[1] ?? start[1] + 24} style={{ textAnchor: leg.fromAt ? 'start' : 'middle' }}>
          {leg.from}
        </text>
      )}
      {leg.to && (
        <text className="map-route__label" x={leg.toAt?.[0] ?? end[0] + 34} y={leg.toAt?.[1] ?? end[1] + 4} style={{ textAnchor: 'start' }}>
          {leg.to}
        </text>
      )}
    </g>
  );
}

function RouteMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 Z" className="map-route__head" />
      </marker>
    </defs>
  );
}

interface FloorPlanProps {
  plan: BuildingPlan;
  floor: Floor;
  /** The venue's room (or rooms, in the editor): lit up. */
  highlight?: string | string[] | null;
  /** In the editor: the room or spot being edited; for students, the room tapped. */
  selected?: string | null;
  /** The way to the venue on this floor. */
  route?: RouteLeg[];
  onRoom?: (room: Room) => void;
  onPhoto?: (photo: PhotoSpot, index: number) => void;
  /** In the editor: a click on the plan itself (to place a photo spot), in plan coordinates. */
  onPlan?: (point: { x: number; y: number }) => void;
  title?: string;
}

/** One floor of the main building: the ring of rooms round the courtyard, main entrance at the bottom. */
export function FloorPlan({ plan, floor, highlight, selected, route = [], onRoom, onPhoto, onPlan, title }: FloorPlanProps) {
  const marker = `map-arrow-${useId().replace(/:/g, '')}`;
  const planClick = (event: MouseEvent<SVGSVGElement>) => {
    if (!onPlan) return;
    const box = event.currentTarget.getBoundingClientRect();
    onPlan({ x: Math.round(((event.clientX - box.left) / box.width) * plan.width), y: Math.round(((event.clientY - box.top) / box.height) * plan.height) });
  };
  const ground = floor.id === 'ground';
  const { outline, court, amphitheatre: amphi, fountain } = plan;
  const isVenue = (room: Room) => (Array.isArray(highlight) ? highlight.includes(room.id) : room.id === highlight);
  const steps = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] } as const;
  return (
    <svg className={`map-plan${onPlan ? ' is-placing' : ''}`} viewBox={`0 0 ${plan.width} ${plan.height}`} role="img" aria-label={title ?? `${floor.name} of the main building`} onClick={planClick}>
      <RouteMarker id={marker} />
      <rect className="map-plan__paper" x="0" y="0" width={plan.width} height={plan.height} rx="18" />
      {/* The building: its floor is the corridor and the hallways; rooms stand on it */}
      <rect className="map-plan__building" x={outline.x} y={outline.y} width={outline.w} height={outline.h} rx="4" />
      <g className={`map-plan__court-group${ground ? '' : ' is-above'}`}>
        <rect className="map-plan__court" x={court.x} y={court.y} width={court.w} height={court.h} rx="10" />
        <circle className="map-plan__amphi" cx={amphi.x} cy={amphi.y} r={amphi.r} />
        <circle className="map-plan__amphi map-plan__amphi--inner" cx={amphi.x} cy={amphi.y} r={amphi.r * 0.62} />
        <circle className="map-plan__amphi map-plan__amphi--stage" cx={amphi.x} cy={amphi.y} r={amphi.r * 0.3} />
        {ground &&
          amphi.steps.map((side) => {
            const [dx, dy] = steps[side];
            const along = dx === 0;
            const sx = amphi.x + dx * (amphi.r + 9);
            const sy = amphi.y + dy * (amphi.r + 9);
            return <rect key={side} className="map-plan__amphi-steps" x={sx - (along ? 16 : 9)} y={sy - (along ? 9 : 16)} width={along ? 32 : 18} height={along ? 18 : 32} rx="3" />;
          })}
        <text className="map-plan__court-label" x={amphi.x} y={amphi.y + 5}>
          Amphitheatre
        </text>
        <circle className="map-plan__fountain" cx={fountain.x} cy={fountain.y} r={fountain.r} />
        <circle className="map-plan__fountain-water" cx={fountain.x} cy={fountain.y} r={fountain.r * 0.55} />
        <text className="map-plan__court-label map-plan__court-label--small" x={fountain.x + fountain.r + 6} y={fountain.y + 4} style={{ textAnchor: 'start' }}>
          Fountain
        </text>
        <text className="map-plan__court-label" x={court.x + court.w / 2} y={court.y + 26}>
          {ground ? 'Courtyard' : 'Courtyard (open to the sky)'}
        </text>
      </g>
      {floor.rooms.map((room) => (
        <RoomBox key={room.id} room={room} isVenue={isVenue(room)} isSelected={room.id === selected} onRoom={onRoom} />
      ))}
      {(floor.marks ?? []).map((mark) => (
        <MarkShape key={mark.id} mark={mark} />
      ))}
      {ground && (
        <g className="map-plan__steps" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <rect key={index} x={outline.x + outline.w / 2 - 44 - index * 6} y={outline.y + outline.h + 2 + index * 6} width={88 + index * 12} height="5" />
          ))}
        </g>
      )}
      {!ground && (
        <text className="map-plan__front" x={outline.x + outline.w / 2} y={outline.y + outline.h + 66}>
          Main entrance side (below)
        </text>
      )}
      {route.map((leg, index) => (
        <Route key={index} leg={leg} marker={marker} />
      ))}
      <g aria-hidden="true">
        {floor.rooms.map((room) => (
          <RoomLabel key={room.id} room={room} isVenue={isVenue(room)} />
        ))}
      </g>
      {floor.photos.map((photo, index) => (
        <PhotoDot key={photo.id} photo={photo} index={index} selected={photo.id === selected} onOpen={onPhoto} />
      ))}
    </svg>
  );
}

function PhotoDot({ photo, index, selected, onOpen }: { photo: PhotoSpot; index: number; selected?: boolean; onOpen?: (photo: PhotoSpot, index: number) => void }) {
  return (
    <g className={`map-dot${selected ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={`Photo ${index + 1}: ${photo.caption || 'view from here'}`} {...activate(() => onOpen?.(photo, index))}>
      <circle cx={photo.x} cy={photo.y} r="15" />
      <text x={photo.x} y={photo.y + 5}>
        {index + 1}
      </text>
    </g>
  );
}

/** The way in on the campus: from the main gate (registration) up the road, to the door to use. */
const CAMPUS_ROUTES: Record<NonNullable<Venue['entrance']>, [number, number][]> = {
  main: [
    [395, 748],
    [395, 336],
  ],
  'side-1': [
    [395, 748],
    [395, 400],
    [230, 400],
    [230, 285],
    [298, 285],
  ],
};

/** Text in lines, centred on (x, y). */
function Lines({ x, y, lines, className, step = 14 }: { x: number; y: number; lines: string[]; className: string; step?: number }) {
  return (
    <text className={className}>
      {lines.map((line, index) => (
        <tspan key={line} x={x} y={y + (index - (lines.length - 1) / 2) * step + 4}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/** From the main gate to the main building (drawn from the campus map board, main entrance at the bottom). */
export function CampusOverview({ photos, entrance = 'main', onPhoto }: { photos: PhotoSpot[]; entrance?: Venue['entrance']; onPhoto?: (photo: PhotoSpot, index: number) => void }) {
  const marker = `map-arrow-${useId().replace(/:/g, '')}`;
  const route = CAMPUS_ROUTES[entrance ?? 'main'];
  return (
    <svg className="map-plan map-campus" viewBox={`0 0 ${CAMPUS.width} ${CAMPUS.height}`} role="img" aria-label="Campus: from the main gate up the road to the main building">
      <RouteMarker id={marker} />
      <rect className="map-campus__ground" x="0" y="0" width={CAMPUS.width} height={CAMPUS.height} rx="18" />
      {/* The road in front of the main building (it ends at the building's front corner on the right)
          and up its left side to side entrance 2, where it ends; the drive's roundabout in front */}
      <path className="map-campus__ring" d="M498 400 L262 400 Q230 400 230 368 L230 78" />
      <circle className="map-campus__roundabout" cx="395" cy="400" r="30" />
      <circle className="map-campus__island" cx="395" cy="400" r="13" />
      {/* The side road to the main auditorium, with the roundabout in front of it, by side entrance 1,
          and the lane up to the mess between the auditorium and the workshop */}
      <rect className="map-campus__road" x="110" y="277" width="120" height="16" />
      <path className="map-campus__lane" d="M127 280 L127 80 L110 80" />
      <circle className="map-campus__roundabout" cx="172" cy="285" r="19" />
      <circle className="map-campus__island" cx="172" cy="285" r="8" />
      <text className="map-campus__label map-campus__label--tiny" x="172" y="322">
        Roundabout
      </text>
      {/* The main building: rooms round the courtyard, main entrance facing the road */}
      <rect className="map-campus__main" x="300" y="40" width="190" height="285" rx="6" />
      <rect className="map-campus__court" x="327" y="67" width="136" height="231" rx="10" />
      <circle className="map-campus__amphi" cx="395" cy="180" r="26" />
      <text className="map-campus__title" x="395" y="235">
        Main building
      </text>
      <rect className="map-campus__portico" x="371" y="322" width="48" height="12" rx="3" />
      <text className="map-campus__label map-campus__label--small" x="429" y="345" style={{ textAnchor: 'start' }}>
        Main entrance
      </text>
      <Lines x={266} y={313} lines={['Side', 'entrance 1']} className="map-campus__label map-campus__label--tiny" step={13} />
      <Lines x={266} y={62} lines={['Side', 'entrance 2']} className="map-campus__label map-campus__label--tiny" step={13} />
      {/* Beside the library side: the canteen, and across the road from it the workshop */}
      <rect className="map-campus__block" x="244" y="166" width="48" height="42" rx="4" />
      <text className="map-campus__label map-campus__label--tiny" x="268" y="191">
        Canteen
      </text>
      {/* The workshop runs from near the roundabout to the far end of the main building */}
      <rect className="map-campus__block" x="144" y="40" width="70" height="222" rx="5" />
      <text className="map-campus__label map-campus__label--small" transform="rotate(-90 179 151)" x="179" y="156">
        Mechanical / electrical workshop
      </text>
      <rect className="map-campus__block" x="24" y="40" width="86" height="80" rx="6" />
      <text className="map-campus__label map-campus__label--small" x="67" y="85">
        Mess
      </text>
      <rect className="map-campus__shed" x="24" y="150" width="86" height="200" rx="6" />
      <Lines x={67} y={250} lines={['Main', 'auditorium']} className="map-campus__label map-campus__label--small map-campus__label--light" step={16} />
      {/* Sports facilities (as on the campus map board) */}
      <ellipse className="map-campus__field" cx="580" cy="585" rx="100" ry="112" />
      <rect className="map-campus__pitch" x="566" y="545" width="28" height="56" rx="3" />
      <text className="map-campus__label" x="580" y="660">
        Cricket ground
      </text>
      <rect className="map-campus__court-d" x="250" y="590" width="88" height="50" rx="4" />
      <text className="map-campus__label map-campus__label--small" x="294" y="660">
        Courts
      </text>
      <rect className="map-campus__block" x="60" y="704" width="140" height="76" rx="6" />
      <text className="map-campus__label map-campus__label--small" x="130" y="746">
        Boys hostel
      </text>
      {/* The road up from the main gate, with its trees, and the side roads */}
      <rect className="map-campus__road" x="30" y="676" width="345" height="14" />
      <rect className="map-campus__road" x="415" y="718" width="265" height="14" />
      <rect className="map-campus__road" x="375" y="428" width="40" height="334" />
      <path className="map-campus__median" d="M395 440 L395 748" />
      {Array.from({ length: 8 }, (_, index) => (
        <g key={index} className="map-campus__trees">
          <circle cx="361" cy={448 + index * 40} r="8" />
          <circle cx="429" cy={448 + index * 40} r="8" />
        </g>
      ))}
      <rect className="map-campus__gate" x="357" y="754" width="76" height="12" rx="3" />
      <text className="map-campus__label map-campus__label--strong" x="395" y="792">
        Main gate: registration
      </text>
      <text className="map-campus__label map-campus__label--small" x="395" y="814">
        You start here
      </text>
      <g className="map-route" aria-hidden="true">
        <polyline className="map-route__casing" points={points(route)} />
        <polyline className="map-route__line" points={points(route)} markerEnd={`url(#${marker})`} />
      </g>
      {photos.map((photo, index) => (
        <PhotoDot key={photo.id} photo={photo} index={index} onOpen={onPhoto} />
      ))}
    </svg>
  );
}

/** A photo spot's picture, over everything, until closed. */
function PhotoViewer({ photo, number, onClose }: { photo: PhotoSpot; number: number; onClose: () => void }) {
  return (
    <div className="map-photo" role="dialog" aria-modal="true" aria-label={`Photo ${number}`} onClick={onClose}>
      <figure onClick={(event) => event.stopPropagation()}>
        <img src={photoUrl(photo.image)} alt={photo.caption || `View from spot ${number}`} />
        <figcaption>
          <strong>You are here ({number}).</strong> {photo.caption}
        </figcaption>
        <button type="button" className="map-button" onClick={onClose} autoFocus>
          Close
        </button>
      </figure>
    </div>
  );
}

interface CampusMapProps {
  map: CampusMapData;
  /** The venue to show (its name as in the event catalog, e.g. 'Delta Lab'). */
  venue?: string | null;
  /** Extra content under the directions (e.g. a help desk line). */
  footer?: ReactNode;
}

/** The map with tabs (campus, then each floor), the venue lit up, the way there, and how to get there. */
export function CampusMap({ map, venue: venueName, footer }: CampusMapProps) {
  const venue = venueOf(map, venueName);
  const [tab, setTab] = useState<string>(venue?.floorId ?? 'campus');
  const [photo, setPhoto] = useState<{ spot: PhotoSpot; number: number } | null>(null);
  const [tapped, setTapped] = useState<Room | null>(null);
  const floor = map.floors.find((item) => item.id === tab);
  const venueFloor = map.floors.find((item) => item.id === venue?.floorId);
  const open = (spot: PhotoSpot, index: number) => setPhoto({ spot, number: index + 1 });
  const legsHere = (venue?.route ?? []).filter((leg) => leg.floorId === tab);
  const routeFloors = new Set((venue?.route ?? []).map((leg) => leg.floorId));

  return (
    <div className="map">
      {venue && (
        <p className="map__where">
          <strong>{venue.name}</strong> is on the <strong>{venueFloor?.name.toLowerCase() ?? 'map'}</strong> of the main building.
        </p>
      )}
      <div className="map__tabs" role="tablist" aria-label="Map">
        {[{ id: 'campus', name: 'Campus' }, ...map.floors].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className="map__tab"
            onClick={() => {
              setTab(item.id);
              setTapped(null);
            }}
          >
            {item.name}
            {item.id === venue?.floorId ? <span className="map__tab-dot" aria-label=" (your venue)" /> : routeFloors.has(item.id) && <span className="map__tab-dot map__tab-dot--route" aria-label=" (on your way)" />}
          </button>
        ))}
      </div>
      <div className="map__canvas">
        {floor ? (
          <FloorPlan plan={map.plan} floor={floor} highlight={venue?.roomId} selected={tapped?.id} route={legsHere} onRoom={setTapped} onPhoto={open} />
        ) : (
          <CampusOverview photos={map.campusPhotos} entrance={venue?.entrance} onPhoto={open} />
        )}
      </div>
      <p className="map__tapped" aria-live="polite">
        {tapped ? (
          <>
            <strong>{tapped.label}</strong> · {ROOM_KINDS[tapped.kind]}
          </>
        ) : (
          'Tap a room to see its name.'
        )}
      </p>
      <p className="map__legend">
        <span className="map__key map__key--venue" /> Your venue <span className="map__key map__key--route" /> The way <span className="map__key map__key--water" /> Drinking water{' '}
        <span className="map__key map__key--glass" /> Glass door (no entry) <span className="map__key map__key--stairs" /> Stairs (lift: staff only) <span className="map__key map__key--dot">1</span> Photo from that spot
      </p>
      {!map.confirmed && <p className="map__note">The layout is being checked. Volunteers on every floor will guide you.</p>}
      {venue && venue.steps.length > 0 && (
        <ol className="map__steps" aria-label={`How to get to ${venue.name}`}>
          {venue.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {footer}
      {photo && <PhotoViewer photo={photo.spot} number={photo.number} onClose={() => setPhoto(null)} />}
    </div>
  );
}
