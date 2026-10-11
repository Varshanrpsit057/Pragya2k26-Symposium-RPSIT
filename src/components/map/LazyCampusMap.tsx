import { Suspense, lazy, type ReactNode } from 'react';

const CampusMapWithData = lazy(() => import('./CampusMapWithData'));

/**
 * The campus map, downloaded the first time one is opened: the layout and the walking paths
 * are about 100 KB, so pages load without them.
 */
export function LazyCampusMap({ venue, footer }: { venue?: string | null; footer?: ReactNode }) {
  return (
    <Suspense fallback={<p className="map-loading">Loading the map…</p>}>
      <CampusMapWithData venue={venue} footer={footer} />
    </Suspense>
  );
}
