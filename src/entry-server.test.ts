// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { render } from './entry-server';

describe('prerender', () => {
  it('renders the front door without touching browser-only APIs', () => {
    const html = render();

    expect(html).toContain('Techfest’26');
    expect(html).toContain('R P Sarathy Institute of Technology');
    expect(html).toContain('href="/landing/admin/"');
    expect(html).toContain('href="/landing/cse/admin/"');
    // Registration and the event pages moved to the students' events website.
    expect(html).not.toMatch(/Register Now|Student login/);
  });
});
