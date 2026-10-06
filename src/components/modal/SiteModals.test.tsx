import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteModalsProvider } from './SiteModals';
import { useSiteModals } from './siteModalsContext';

function Probe() {
  const { windowOpen, openRegistration, openDevCrew } = useSiteModals();
  return (
    <>
      <output aria-label="window open">{String(windowOpen)}</output>
      <button type="button" onClick={() => openRegistration()}>
        form
      </button>
      <button type="button" onClick={openDevCrew}>
        crew
      </button>
    </>
  );
}

describe('SiteModalsProvider', () => {
  it('reports whether any of its windows is open, so the page can rest behind it', () => {
    render(
      <SiteModalsProvider>
        <Probe />
      </SiteModalsProvider>,
    );
    const state = screen.getByLabelText('window open');
    expect(state).toHaveTextContent('false');

    act(() => screen.getByRole('button', { name: 'form' }).click());
    expect(state).toHaveTextContent('true');
  });
});
