import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { Landing } from './landing/Landing';

/** Used at build time only, to prerender the page into dist/index.html. */
export function render(): string {
  return renderToString(
    <StrictMode>
      <Landing />
    </StrictMode>,
  );
}
