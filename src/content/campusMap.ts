import type { CampusMap } from '../lib/campusMap';
import layout from './campusMap.json';

/**
 * The published campus map. To change it, edit it in the dashboard (Campus map), download the
 * layout file and put it here as campusMap.json; the photos go in public/images/map/.
 */
export const campusMap = layout as CampusMap;
