/**
 * The campus map for students: the way from the main gate to the main building, and each floor
 * of the main building with the venue lit up, step-by-step directions, and photo dots that
 * show the picture taken from that spot ("you are here"). Plain SVG: no map service, and the
 * photos load only when a dot is tapped, so it is light on the campus network.
 */
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { PLAN, ROOM_KINDS, photoUrl, venueOf, type CampusMap as CampusMapData, type Floor, type PhotoSpot, type Room } from '../../lib/campusMap';
import './CampusMap.css';

/** Splits a room label into at most two lines that fit its box. */
function lines(label: string, width: number): string[] {
  const max = Math.max(4, Math.floor(width / 9.5));
  if (label.length <= max) return [label];
  const words = label.split(' ');
  let first = '';
  while (words.length && `${first} ${words[0]}`.trim().length <= max) first = `${first} ${words.shift()}`.trim();
  if (!first) first = words.shift() ?? '';
  const rest = words.join(' ');
  return rest ? [first, rest.length > max ? `${rest.slice(0, max - 1)}…` : rest] : [first];
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

interface FloorPlanProps {
  floor: Floor;
  /** The venue's room (or rooms, in the editor): lit up. */
  highlight?: string | string[] | null;
  /** In the editor: the room or spot being edited. */
  selected?: string | null;
  onRoom?: (room: Room) => void;
  onPhoto?: (photo: PhotoSpot, index: number) => void;
  /** In the editor: a click on the plan itself (to place a photo spot), in plan coordinates. */
  onPlan?: (point: { x: number; y: number }) => void;
  title?: string;
}

/** One floor of the main building: the ring of rooms around the courtyard, entrance at the bottom. */
export function FloorPlan({ floor, highlight, selected, onRoom, onPhoto, onPlan, title }: FloorPlanProps) {
  const planClick = (event: MouseEvent<SVGSVGElement>) => {
    if (!onPlan) return;
    const box = event.currentTarget.getBoundingClientRect();
    onPlan({ x: Math.round(((event.clientX - box.left) / box.width) * PLAN.width), y: Math.round(((event.clientY - box.top) / box.height) * (PLAN.height + 40)) });
  };
  const ground = floor.id === 'ground';
  return (
    <svg className={`map-plan${onPlan ? ' is-placing' : ''}`} viewBox={`0 0 ${PLAN.width} ${PLAN.height + 40}`} role="img" aria-label={title ?? `${floor.name} of the main building`} onClick={planClick}>
      <rect className="map-plan__paper" x="0" y="0" width={PLAN.width} height={PLAN.height + 40} rx="18" />
      {/* The building and the corridor that runs round the courtyard */}
      <rect className="map-plan__building" x="40" y="50" width="920" height="640" rx="10" />
      <rect className="map-plan__corridor" x="200" y="170" width="600" height="380" rx="26" />
      <rect className="map-plan__court" x="230" y="200" width="540" height="320" rx="40" />
      <circle className="map-plan__amphi" cx="500" cy="360" r="70" />
      <circle className="map-plan__amphi" cx="500" cy="360" r="38" />
      <text className="map-plan__court-label" x="500" y="300">
        Courtyard
      </text>
      <text className="map-plan__corridor-label" x="500" y="190">
        Corridor around the courtyard
      </text>
      {floor.rooms.map((room) => {
        const isVenue = Array.isArray(highlight) ? highlight.includes(room.id) : room.id === highlight;
        const text = lines(room.label, room.w);
        const interactive = Boolean(onRoom);
        return (
          <g
            key={room.id}
            className={`map-room map-room--${room.kind}${isVenue ? ' is-venue' : ''}${room.id === selected ? ' is-selected' : ''}`}
            {...(interactive && { role: 'button', tabIndex: 0, 'aria-label': `${room.label} (${ROOM_KINDS[room.kind]})`, ...activate(() => onRoom?.(room)) })}
          >
            <title>{`${room.label} · ${ROOM_KINDS[room.kind]}`}</title>
            <rect x={room.x + 3} y={room.y + 3} width={room.w - 6} height={room.h - 6} rx="6" />
            {text.map((line, index) => (
              <text key={line} x={room.x + room.w / 2} y={room.y + room.h / 2 + (index - (text.length - 1) / 2) * 18 + 5}>
                {line}
              </text>
            ))}
          </g>
        );
      })}
      {ground && (
        <g className="map-plan__entry">
          <path d="M500 735 L500 700 M488 712 L500 700 L512 712" />
          <text x="500" y="752">
            Main entrance · from the main road
          </text>
        </g>
      )}
      {!ground && (
        <text className="map-plan__front" x="500" y="725">
          Front of the building (main entrance below)
        </text>
      )}
      {floor.photos.map((photo, index) => (
        <PhotoDot key={photo.id} photo={photo} index={index} selected={photo.id === selected} onOpen={onPhoto} />
      ))}
    </svg>
  );
}

function PhotoDot({ photo, index, selected, onOpen }: { photo: PhotoSpot; index: number; selected?: boolean; onOpen?: (photo: PhotoSpot, index: number) => void }) {
  return (
    <g className={`map-dot${selected ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={`Photo ${index + 1}: ${photo.caption || 'view from here'}`} {...activate(() => onOpen?.(photo, index))}>
      <circle cx={photo.x} cy={photo.y} r="17" />
      <text x={photo.x} y={photo.y + 6}>
        {index + 1}
      </text>
    </g>
  );
}

/** From the main gate to the main building (drawn from the campus map board and photos). */
export function CampusOverview({ photos, onPhoto }: { photos: PhotoSpot[]; onPhoto?: (photo: PhotoSpot, index: number) => void }) {
  return (
    <svg className="map-plan map-campus" viewBox={`0 0 ${PLAN.width} ${PLAN.height + 40}`} role="img" aria-label="Campus: from the main gate up the main road to the main building">
      <rect className="map-campus__ground" x="0" y="0" width={PLAN.width} height={PLAN.height + 40} rx="18" />
      {/* The ground (right) */}
      <ellipse className="map-campus__field" cx="770" cy="520" rx="170" ry="130" />
      <text className="map-campus__label" x="770" y="527">
        Ground
      </text>
      {/* Buildings on the left of the main building */}
      <rect className="map-campus__shed" x="60" y="150" width="230" height="110" rx="6" />
      <text className="map-campus__label" x="175" y="210">
        Main auditorium
      </text>
      <rect className="map-campus__shed" x="90" y="290" width="200" height="80" rx="6" />
      <text className="map-campus__label" x="190" y="336">
        Mechanical workshop
      </text>
      <rect className="map-campus__block" x="70" y="50" width="150" height="80" rx="6" />
      <text className="map-campus__label" x="145" y="96">
        Mess
      </text>
      {/* The main building: a ring round the courtyard, entrance facing the road */}
      <rect className="map-campus__main" x="340" y="50" width="320" height="250" rx="10" />
      <rect className="map-campus__court" x="400" y="105" width="200" height="140" rx="30" />
      <circle className="map-campus__amphi" cx="500" cy="175" r="34" />
      <rect className="map-campus__portico" x="470" y="288" width="60" height="24" rx="3" />
      <text className="map-campus__title" x="500" y="40">
        Main building
      </text>
      {/* The drive, the main road with its median and trees, and the gate */}
      <ellipse className="map-campus__road" cx="500" cy="350" rx="150" ry="34" />
      <circle className="map-campus__island" cx="500" cy="350" r="16" />
      <rect className="map-campus__road" x="475" y="350" width="50" height="360" />
      <path className="map-campus__median" d="M500 380 L500 700" />
      {Array.from({ length: 8 }, (_, index) => (
        <g key={index} className="map-campus__trees">
          <circle cx="455" cy={400 + index * 40} r="11" />
          <circle cx="545" cy={400 + index * 40} r="11" />
        </g>
      ))}
      <rect className="map-campus__gate" x="440" y="704" width="120" height="16" rx="4" />
      <text className="map-campus__label map-campus__label--strong" x="500" y="745">
        Main gate: you enter here
      </text>
      {/* The way in */}
      <path className="map-campus__route" d="M500 700 L500 330" />
      <path className="map-campus__arrow" d="M486 344 L500 322 L514 344" />
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

/** The map with tabs (campus, then each floor), the venue lit up, and how to get there. */
export function CampusMap({ map, venue: venueName, footer }: CampusMapProps) {
  const venue = venueOf(map, venueName);
  const [tab, setTab] = useState<string>(venue?.floorId ?? 'campus');
  const [photo, setPhoto] = useState<{ spot: PhotoSpot; number: number } | null>(null);
  const floor = map.floors.find((item) => item.id === tab);
  const venueFloor = map.floors.find((item) => item.id === venue?.floorId);
  const open = (spot: PhotoSpot, index: number) => setPhoto({ spot, number: index + 1 });

  return (
    <div className="map">
      {venue && (
        <p className="map__where">
          <strong>{venue.name}</strong> is on the <strong>{venueFloor?.name.toLowerCase() ?? 'map'}</strong> of the main building.
        </p>
      )}
      <div className="map__tabs" role="tablist" aria-label="Map">
        {[{ id: 'campus', name: 'Campus' }, ...map.floors].map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className="map__tab" onClick={() => setTab(item.id)}>
            {item.name}
            {item.id === venue?.floorId && <span className="map__tab-dot" aria-label=" (your venue)" />}
          </button>
        ))}
      </div>
      <div className="map__canvas">
        {floor ? <FloorPlan floor={floor} highlight={venue?.roomId} onPhoto={open} /> : <CampusOverview photos={map.campusPhotos} onPhoto={open} />}
      </div>
      <p className="map__legend">
        <span className="map__key map__key--venue" /> Your venue <span className="map__key map__key--stairs" /> Stairs <span className="map__key map__key--dot">1</span> Tap a number to see the photo from that spot
      </p>
      {!map.confirmed && <p className="map__note">Room positions are approximate. Volunteers on every floor will guide you.</p>}
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
