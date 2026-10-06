import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { crew } from '../../content/crew';
import { DevCrewModal, initials } from './DevCrew';

const originalPhotos = crew.map((member) => member.photo);

afterEach(() => {
  crew.forEach((member, index) => {
    member.photo = originalPhotos[index];
  });
});

const card = (name: string) => screen.getByRole('article', { name: new RegExp(`^${name},`) });
const renderCrew = () => render(<DevCrewModal open onClose={() => {}} />);

describe('DevCrewModal', () => {
  it('shows one profile card per developer, in order, in a window', () => {
    renderCrew();

    expect(screen.getByRole('dialog', { name: 'Dev Crew' })).toHaveAttribute('open');
    expect(screen.getByRole('heading', { level: 2, name: 'Dev Crew' })).toBeInTheDocument();
    const names = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(names).toEqual(['Mohan Prabu K', 'Varshan C', 'Barath S']);
    expect(screen.queryByText(/DEV 00/)).toBeNull();
  });

  it('gives each developer their role and class', () => {
    renderCrew();

    expect(within(card('Mohan Prabu K')).getByText('Senior Developer')).toBeInTheDocument();
    expect(within(card('Varshan C')).getByText('Frontend Developer')).toBeInTheDocument();
    expect(within(card('Barath S')).getByText('Backend Developer')).toBeInTheDocument();
    crew.forEach((member) => expect(within(card(member.name)).getByText('III Year – AI&DS')).toBeInTheDocument());
  });

  it('uses each GitHub username as the handle', () => {
    renderCrew();

    expect(within(card('Mohan Prabu K')).getByText('@MohanPrabu018-K')).toBeInTheDocument();
    expect(within(card('Varshan C')).getByText('@Varshanrpsit057')).toBeInTheDocument();
    expect(within(card('Barath S')).getByText('@Barath-S-07')).toBeInTheDocument();
  });

  it('links each profile, opening safely in a new tab', () => {
    renderCrew();

    const expected: Record<string, string[]> = {
      'Mohan Prabu K': [
        'https://www.linkedin.com/in/mohan-prabu-k-061739325',
        'https://github.com/MohanPrabu018-K',
        'https://portfolio.mohanprabu018.workers.dev/',
      ],
      'Varshan C': ['https://www.linkedin.com/in/varshan-c-56b30a339', 'https://github.com/Varshanrpsit057'],
      'Barath S': ['https://www.linkedin.com/in/barath-sivalingam-4ba41a330', 'https://github.com/Barath-S-07'],
    };

    for (const [name, urls] of Object.entries(expected)) {
      const links = within(card(name)).getAllByRole('link');
      expect(links.map((link) => link.getAttribute('href'))).toEqual(urls);
      links.forEach((link) => {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(link).toHaveAccessibleName(expect.stringContaining(name));
      });
    }
  });

  it('gives only Mohan a portfolio link', () => {
    renderCrew();

    expect(screen.getAllByRole('link', { name: /portfolio/i })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /portfolio/i })).toHaveAccessibleName(
      'Portfolio of Mohan Prabu K (opens in a new tab)',
    );
  });

  it('shows each portrait, and initials for anyone without one', () => {
    crew[0].photo = '/mohan.webp';
    crew[1].photo = undefined;
    renderCrew();

    expect(screen.getByRole('img', { name: 'Portrait of Mohan Prabu K' })).toHaveAttribute('src', '/mohan.webp');
    expect(within(card('Varshan C')).queryByRole('img', { name: /Portrait/ })).toBeNull();
    expect(within(card('Varshan C')).getByText('VC')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the cards still under the mouse: no tilt, glow or hover shine', () => {
    const { container } = renderCrew();

    expect(container.querySelectorAll('.pc-card-wrapper--static')).toHaveLength(crew.length);
    expect(container.querySelector('.pc-behind')).toBeNull();
  });

  it('has a portrait for every developer from dev_crew/', () => {
    crew.forEach((member) => expect(member.photo, member.name).toMatch(/\.webp/));
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Mohan Prabu K')).toBe('MP');
    expect(initials('Varshan C')).toBe('VC');
    expect(initials('barath s')).toBe('BS');
  });
});
