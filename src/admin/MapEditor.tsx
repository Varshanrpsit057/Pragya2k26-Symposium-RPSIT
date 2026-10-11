/**
 * The campus map editor (admins and the web assistant team): name every class and lab on each
 * floor, place photo spots (dots that show the picture taken from there), and write the way
 * to each venue. Work is kept in this browser as a draft. To publish: download the layout
 * file and put it in src/content/campusMap.json, with the photos in public/images/map/ (send
 * both to the web team). Each floor also downloads as a printable plan, to mark by hand.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import mapCss from '../components/map/CampusMap.css?raw';
import { CampusMap, CampusOverview, FloorPlan } from '../components/map/CampusMap';
import { campusMap as published } from '../content/campusMap';
import { CAMPUS, ROOM_KINDS, mapProblem, photoUrl, type CampusMap as CampusMapData, type PhotoSpot, type RoomKind } from '../lib/campusMap';
import { saveFile } from './ui';

const DRAFT = 'pragya-campus-map-draft';

function loadDraft(): CampusMapData | null {
  try {
    const raw = localStorage.getItem(DRAFT);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && !mapProblem(value) ? (value as CampusMapData) : null;
  } catch {
    return null;
  }
}

type Selection = { type: 'room'; id: string } | { type: 'photo'; id: string } | null;

export function MapEditor() {
  const [map, setMap] = useState<CampusMapData>(() => loadDraft() ?? structuredClone(published));
  const [tab, setTab] = useState<string>(map.floors[0]?.id ?? 'campus');
  const [selected, setSelected] = useState<Selection>(null);
  const [placing, setPlacing] = useState<'add' | 'move' | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [previewVenue, setPreviewVenue] = useState(map.venues[0]?.name ?? '');
  const planBox = useRef<HTMLDivElement>(null);

  // The draft survives a reload or a closed tab, until it is published or reset.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT, JSON.stringify(map));
    } catch {
      // Storage blocked: download the layout file before leaving.
    }
  }, [map]);

  const floor = map.floors.find((item) => item.id === tab) ?? null;
  const photos = floor ? floor.photos : map.campusPhotos;
  const room = floor && selected?.type === 'room' ? floor.rooms.find((item) => item.id === selected.id) : undefined;
  const photo = selected?.type === 'photo' ? photos.find((item) => item.id === selected.id) : undefined;

  const update = (change: (draft: CampusMapData) => void) =>
    setMap((current) => {
      const draft = structuredClone(current);
      change(draft);
      return draft;
    });
  const photosOf = (draft: CampusMapData) => (floor ? draft.floors.find((item) => item.id === floor.id)!.photos : draft.campusPhotos);

  const placeAt = ({ x, y }: { x: number; y: number }) => {
    if (placing === 'add') {
      const id = `spot-${Date.now().toString(36)}`;
      update((draft) => photosOf(draft).push({ id, x, y, image: '', caption: '' }));
      setSelected({ type: 'photo', id });
    } else if (placing === 'move' && photo) {
      update((draft) => Object.assign(photosOf(draft).find((item) => item.id === photo.id)!, { x, y }));
    }
    setPlacing(null);
  };

  const setRoom = (fields: { label?: string; kind?: RoomKind }) =>
    update((draft) => Object.assign(draft.floors.find((item) => item.id === floor!.id)!.rooms.find((item) => item.id === room!.id)!, fields));
  const setPhoto = (fields: Partial<PhotoSpot>) => update((draft) => Object.assign(photosOf(draft).find((item) => item.id === photo!.id)!, fields));

  /** Makes this room the venue (and names it after the venue if it still has a default name). */
  const makeVenue = (venueName: string) =>
    update((draft) => {
      for (const venue of draft.venues) {
        // Moved to another room: the way drawn to the old room no longer fits, so it is dropped.
        if (venue.name === venueName && venue.roomId !== room!.id) Object.assign(venue, { floorId: floor!.id, roomId: room!.id, route: undefined });
      }
      const target = draft.floors.find((item) => item.id === floor!.id)!.rooms.find((item) => item.id === room!.id)!;
      if (/^Room /.test(target.label)) target.label = venueName;
    });
  const venueHere = room ? map.venues.find((venue) => venue.roomId === room.id)?.name ?? '' : '';

  const choosePreview = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !photo) return;
    setPreviews((current) => ({ ...current, [photo.id]: URL.createObjectURL(file) }));
    if (!photo.image) setPhoto({ image: file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-') });
  };

  const download = () => {
    saveFile('campusMap.json', `${JSON.stringify(map, null, 2)}\n`, 'application/json');
    setMessage('Downloaded campusMap.json. Send it with the photos (named as in the spots) to the web team to publish.');
  };

  const load = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const value: unknown = JSON.parse(await file.text());
      const problem = mapProblem(value);
      if (problem) return setMessage(problem);
      setMap(value as CampusMapData);
      setSelected(null);
      setMessage(`Loaded ${file.name}.`);
    } catch {
      setMessage('That file could not be read as a layout file.');
    }
  };

  const reset = () => {
    if (!window.confirm('Throw away this draft and start again from the published map?')) return;
    setMap(structuredClone(published));
    setSelected(null);
    setMessage('Started again from the published map.');
  };

  /** This floor as an SVG file, to print and mark by hand. */
  const printable = () => {
    const svg = planBox.current?.querySelector('svg');
    if (!svg) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = mapCss;
    copy.insertBefore(style, copy.firstChild);
    saveFile(`PRAGYA-map-${tab}.svg`, new XMLSerializer().serializeToString(copy), 'image/svg+xml');
  };

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Campus map</h2>
          <span className="adm-muted">Draft saved in this browser</span>
        </div>
        <p className="adm-muted">
          Click a room to name it (class or lab names) and set what it is, or make it a venue. Add photo spots where you will take pictures: students tap a number to see exactly
          where they stand. Then download the layout file and send it with the photos to the web team.
        </p>
        <div className="adm-actions__row">
          <button className={`adm-button adm-button--big${placing === 'add' ? ' adm-button--primary' : ''}`} type="button" onClick={() => setPlacing(placing === 'add' ? null : 'add')}>
            {placing === 'add' ? 'Click on the map to place it…' : '+ Add photo spot'}
          </button>
          <button className="adm-button adm-button--big adm-button--approve" type="button" onClick={download}>
            Download layout file
          </button>
          <label className="adm-button adm-button--big">
            Load a layout file
            <input className="adm-visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void load(event)} />
          </label>
          <button className="adm-button adm-button--big" type="button" onClick={printable}>
            Download this floor to print
          </button>
          <button className="adm-button" type="button" onClick={reset}>
            Start again
          </button>
        </div>
        <label className="adm-check">
          <input type="checkbox" checked={map.confirmed} onChange={(event) => update((draft) => void (draft.confirmed = event.target.checked))} />
          <span>The room positions are checked (students then no longer see "Room positions are approximate").</span>
        </label>
        {message && <p className="adm-note">{message}</p>}

        <div className="adm-tabs" role="tablist" aria-label="Floor">
          {[{ id: 'campus', name: 'Campus' }, ...map.floors].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className="adm-tab"
              onClick={() => {
                setTab(item.id);
                setSelected(null);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>

        <div className="adm-map-editor">
          <div ref={planBox} className="adm-map-editor__plan">
            {floor ? (
              <FloorPlan
                plan={map.plan}
                floor={floor}
                highlight={map.venues.filter((venue) => venue.floorId === floor.id).map((venue) => venue.roomId)}
                selected={selected?.id ?? null}
                // While placing a spot, a click anywhere (rooms too) places it.
                onRoom={placing ? undefined : (item) => setSelected({ type: 'room', id: item.id })}
                onPhoto={(item) => setSelected({ type: 'photo', id: item.id })}
                onPlan={placing ? placeAt : undefined}
              />
            ) : (
              <div className={placing ? 'adm-map-editor__placing' : undefined} onClick={(event) => {
                if (!placing) return;
                const svg = event.currentTarget.querySelector('svg')!;
                const box = svg.getBoundingClientRect();
                placeAt({ x: Math.round(((event.clientX - box.left) / box.width) * CAMPUS.width), y: Math.round(((event.clientY - box.top) / box.height) * CAMPUS.height) });
              }}>
                <CampusOverview photos={map.campusPhotos} onPhoto={(item) => setSelected({ type: 'photo', id: item.id })} />
              </div>
            )}
          </div>

          <aside className="adm-card adm-pad adm-map-editor__panel" aria-label="Edit">
            {room && floor && (
              <>
                <h3 className="adm-h3">{floor.name}: room</h3>
                <label className="adm-field">
                  <span>Name (as students will see it)</span>
                  <input value={room.label} maxLength={40} onChange={(event) => setRoom({ label: event.target.value })} autoFocus />
                </label>
                <label className="adm-field">
                  <span>What is it?</span>
                  <select value={room.kind} onChange={(event) => setRoom({ kind: event.target.value as RoomKind })}>
                    {(Object.entries(ROOM_KINDS) as [RoomKind, string][]).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="adm-field">
                  <span>Venue in this room</span>
                  <select value={venueHere} onChange={(event) => event.target.value && makeVenue(event.target.value)}>
                    <option value="">None</option>
                    {map.venues.map((venue) => (
                      <option key={venue.name} value={venue.name}>
                        {venue.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {photo && (
              <>
                <h3 className="adm-h3">Photo spot {photos.indexOf(photo) + 1}</h3>
                {(previews[photo.id] || photo.image) && <img className="adm-map-editor__photo" src={previews[photo.id] ?? photoUrl(photo.image)} alt="" />}
                <label className="adm-field">
                  <span>Photo file name (in public/images/map/)</span>
                  <input value={photo.image} onChange={(event) => setPhoto({ image: event.target.value.trim() })} placeholder="e.g. second-floor-stairs.jpg" />
                </label>
                <label className="adm-field">
                  <span>Preview a photo from this computer (not uploaded)</span>
                  <input type="file" accept="image/*" onChange={choosePreview} />
                </label>
                <label className="adm-field">
                  <span>What the student sees from here</span>
                  <input value={photo.caption} maxLength={120} onChange={(event) => setPhoto({ caption: event.target.value })} placeholder="e.g. Top of the front stairs, second floor: turn left" />
                </label>
                <div className="adm-actions__row">
                  <button className="adm-button" type="button" onClick={() => setPlacing('move')}>
                    {placing === 'move' ? 'Click the new place…' : 'Move'}
                  </button>
                  <button
                    className="adm-button adm-button--danger-outline"
                    type="button"
                    onClick={() => {
                      update((draft) => {
                        const list = photosOf(draft);
                        list.splice(list.findIndex((item) => item.id === photo.id), 1);
                      });
                      setSelected(null);
                    }}
                  >
                    Delete spot
                  </button>
                </div>
              </>
            )}
            {!room && !photo && <p className="adm-muted">Click a room or a photo spot to edit it.</p>}
          </aside>
        </div>
      </section>

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">Directions to each venue</h3>
        <p className="adm-muted">One step per line. Students see them under the map.</p>
        <div className="adm-form adm-form--two">
          {map.venues.map((venue) => (
            <label key={venue.name} className="adm-field">
              <span>
                {venue.name} · {map.floors.find((item) => item.id === venue.floorId)?.name ?? 'not placed'}
              </span>
              <textarea
                rows={5}
                value={venue.steps.join('\n')}
                onChange={(event) =>
                  update((draft) => {
                    draft.venues.find((item) => item.name === venue.name)!.steps = event.target.value.split('\n').map((line) => line.trimStart()).filter((line, index, all) => line || index < all.length - 1);
                  })
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h3 className="adm-h3">What students will see</h3>
          <select value={previewVenue} onChange={(event) => setPreviewVenue(event.target.value)} aria-label="Venue to preview">
            {map.venues.map((venue) => (
              <option key={venue.name}>{venue.name}</option>
            ))}
          </select>
        </div>
        <div className="adm-map-preview">
          <CampusMap key={previewVenue} map={map} venue={previewVenue} />
        </div>
      </section>
    </main>
  );
}
