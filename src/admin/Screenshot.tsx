import { useEffect, useState } from 'react';
import { SignedOut, type ScreenshotLinks } from './adminApi';
import { messageOf } from './ui';

/**
 * A private payment screenshot, big enough to read the amount, the time and the transaction
 * ID, with zoom. `load` (stable) fetches its short-lived links: a small copy to show (quick on
 * a busy network) and the original as uploaded; Reload fetches new ones.
 */
export function Screenshot({ load, alt, onSignedOut }: { load: () => Promise<ScreenshotLinks>; alt: string; onSignedOut: () => void }) {
  const [links, setLinks] = useState<ScreenshotLinks | null>(null);
  const url = links?.url ?? null;
  const [problem, setProblem] = useState('');
  const [loads, setLoads] = useState(0);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let active = true;
    load().then(
      (value) => {
        if (!active) return;
        setLinks(value);
        setProblem('');
      },
      (failure: unknown) => {
        if (!active) return;
        if (failure instanceof SignedOut) onSignedOut();
        else setProblem(messageOf(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [load, loads, onSignedOut]);

  return (
    <figure className={`adm-shot adm-shot--big${zoom ? ' adm-shot--zoom' : ''}`}>
      {url ? (
        <button type="button" className="adm-shot__frame" aria-pressed={zoom} title={zoom ? 'Make smaller' : 'Zoom in'} onClick={() => setZoom(!zoom)}>
          <img src={url} alt={alt} onError={() => setProblem('The screenshot could not be shown (its link may have expired). Press Reload.')} />
        </button>
      ) : (
        <p className="adm-muted">{problem || 'Loading the screenshot…'}</p>
      )}
      <figcaption className="adm-shot__links">
        <button type="button" className="adm-link" disabled={!url} onClick={() => setZoom(!zoom)}>
          {zoom ? 'Make smaller' : 'Zoom in'}
        </button>
        {links && (
          <a href={links.originalUrl ?? links.url} target="_blank" rel="noopener noreferrer">
            {links.originalUrl ? 'Open the original' : 'Open full size'}
          </a>
        )}
        <button type="button" className="adm-link" onClick={() => setLoads((count) => count + 1)}>
          Reload
        </button>
      </figcaption>
      {problem && url && <p className="adm-field__error">{problem}</p>}
    </figure>
  );
}
