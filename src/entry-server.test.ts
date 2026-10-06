// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { render } from './entry-server';

describe('prerender', () => {
  it('renders the page without touching browser-only APIs', () => {
    const html = render();

    expect(html).toContain('PRAGYA');
    expect(html).toContain('R P Sarathy Institute of Technology, Salem');
    expect(html).toContain('id="technical"');
    expect(html).toContain('id="non-technical"');
  });
});
