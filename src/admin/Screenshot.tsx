import { useEffect, useState } from 'react';
import { SignedOut } from './adminApi';
import { messageOf } from './ui';

/**
 * A private payment screenshot, big enough to read the amount, the time and the transaction
 * ID, with zoom. `load` (stable) fetches its short-lived link; Reload fetches a new one.
 */
export function Screenshot({ load, alt, onSignedOut }: { load: () => Promise<string>; alt: string; onSignedOut: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [loads, setLoads] = useState(0);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let active = true;
    load().then(
      (value) => {
        if (!active) return;
        setUrl(value);
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
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open full size
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
