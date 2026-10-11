import type { ReactNode } from 'react';
import { campusMap } from '../../content/campusMap';
import { CampusMap } from './CampusMap';

/** The campus map with its layout: loaded only when a map is opened (see LazyCampusMap). */
export default function CampusMapWithData({ venue, footer }: { venue?: string | null; footer?: ReactNode }) {
  return <CampusMap map={campusMap} venue={venue} footer={footer} />;
}
