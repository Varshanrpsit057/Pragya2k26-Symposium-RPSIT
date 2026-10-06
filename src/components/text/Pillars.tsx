import type { CSSProperties } from 'react';

interface PillarsProps {
  words: readonly string[];
  style?: CSSProperties;
}

/** "Think • Create • Compete • Innovate": short words on one line. The dots are not read aloud. */
export function Pillars({ words, style }: PillarsProps) {
  return (
    <p className="section-pillars" data-reveal style={style}>
      {words.map((word, index) => (
        <span key={word}>
          {index > 0 && (
            <span className="section-pillars__dot" aria-hidden="true">
              {' • '}
            </span>
          )}
          {word}
        </span>
      ))}
    </p>
  );
}
