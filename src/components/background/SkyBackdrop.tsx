import { useEffect, useState, type ComponentType } from 'react';
import { usePageVisible } from '../../hooks/usePageVisible';
import {
  backdropQuality,
  chooseBackdropMode,
  readDeviceSignals,
  type BackdropQuality,
} from '../../lib/capabilities';
import { useSiteModals } from '../modal/siteModalsContext';
import type { GhostFibersProps } from './GhostFibers';
import './SkyBackdrop.css';

interface LoadedFibers {
  Component: ComponentType<GhostFibersProps>;
  quality: BackdropQuality;
}

/**
 * The background behind the whole page, fixed to the viewport. A still CSS gradient paints
 * immediately; on capable devices the animated WebGL GhostFibers is fetched during idle
 * time and fades in over it. It moves slowly and on its own (no pointer interaction), and
 * rests while the tab is hidden or one of the site's windows (such as the registration
 * form) is open. Slow devices, data saver and reduced motion keep the CSS gradient.
 */
export function SkyBackdrop() {
  const [fibers, setFibers] = useState<LoadedFibers | null>(null);
  const [fibersReady, setFibersReady] = useState(false);
  const pageVisible = usePageVisible();
  const { windowOpen } = useSiteModals();

  useEffect(() => {
    if (chooseBackdropMode(readDeviceSignals()) !== 'webgl') return;

    let cancelled = false;
    const load = () => {
      import('./GhostFibers')
        .then((module) => {
          if (cancelled) return;
          const coarse = window.matchMedia('(pointer: coarse)').matches;
          setFibers({ Component: module.default, quality: backdropQuality(window.innerWidth, coarse) });
        })
        .catch(() => {
          // Network or parse failure: the CSS gradient simply stays.
        });
    };

    // Safari only recently gained requestIdleCallback; fall back to a short timer.
    const supportsIdle = typeof window.requestIdleCallback === 'function';
    const idleId = supportsIdle
      ? window.requestIdleCallback(load, { timeout: 2000 })
      : window.setTimeout(load, 800);

    return () => {
      cancelled = true;
      if (supportsIdle) window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, []);

  const Fibers = fibers?.Component;

  return (
    <div className="sky-backdrop" data-fibers={fibersReady ? 'ready' : undefined} aria-hidden="true">
      <div className="sky-backdrop__layers">
        <div className="sky-backdrop__glow" />
        {Fibers && fibers && (
          <Fibers
            className="sky-backdrop__fibers"
            paused={!pageVisible || windowOpen}
            renderScale={fibers.quality.renderScale}
            maxFps={fibers.quality.maxFps}
            layers={fibers.quality.layers}
            backgroundColor="#05061a"
            lineColor="#140E35"
            glowColor="#3437A0"
            onReady={() => setFibersReady(true)}
            onError={() => setFibers(null)}
          />
        )}
      </div>
    </div>
  );
}
