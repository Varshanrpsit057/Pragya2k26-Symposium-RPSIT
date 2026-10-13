// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { render } from './entry-server';

describe('prerender', () => {
  it('renders the front door without touching browser-only APIs', () => {
    const html = render();

    expect(html).toContain('Techfest’26');
    expect(html).toContain('R P Sarathy Institute of Technology');
    expect(html).toContain('href="/register/"');
    // No staff page is linked: staff open /landing/admin/ by its address.
    expect(html).not.toContain('/admin/"');
    expect(html).toContain('Overall coordinated by the');
    // The route map is gone from this site.
    expect(html).not.toMatch(/route-map|Route map/);
  });
});
