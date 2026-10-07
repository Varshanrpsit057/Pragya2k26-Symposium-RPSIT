import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { site } from '../../content/site';
import { CONTACT_PENDING_MESSAGE, Footer } from './Footer';

const originalContacts = site.contacts;
const originalEmail = site.email;
const originalPhones = site.college.phones;

afterEach(() => {
  site.contacts = originalContacts;
  site.email = originalEmail;
  site.college.phones = originalPhones;
});

describe('Footer', () => {
  it('credits only Mohan Prabu K under "Developed by", with his role and class', () => {
    render(<Footer links={[]} />);

    const credits = screen.getByRole('heading', { name: 'Developed by' }).closest('.footer__credits') as HTMLElement;
    expect(within(credits).getAllByRole('listitem')).toHaveLength(1);
    expect(within(credits).getByText('Mohan Prabu K')).toBeInTheDocument();
    expect(within(credits).getByText('Senior Developer · III Year – AI&DS')).toBeInTheDocument();
    expect(within(credits).queryByText(/Varshan|Barath/)).toBeNull();
  });

  it('leaves the Dev Crew button to the navigation', () => {
    render(<Footer links={[]} />);

    expect(screen.queryByRole('button', { name: 'Meet the Dev Crew' })).toBeNull();
  });

  it('gives the overall coordinator as the contact, with a number to call', () => {
    render(<Footer links={[]} />);

    expect(screen.getByRole('heading', { name: 'Coordinator contact' })).toBeInTheDocument();
    expect(screen.getByText('Balajimanikandhaan S.S')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+91 73582 13736' })).toHaveAttribute('href', 'tel:+917358213736');
  });

  it('says contact details are coming while none are set', () => {
    site.contacts = [];
    site.email = null;
    render(<Footer links={[]} />);

    expect(screen.getByText(CONTACT_PENDING_MESSAGE)).toBeInTheDocument();
  });

  it('lists contacts once they are added', () => {
    site.contacts = [{ name: 'Event Desk', role: 'Coordinator', email: 'desk@example.edu' }];
    site.email = null;
    render(<Footer links={[]} />);

    expect(screen.queryByText(CONTACT_PENDING_MESSAGE)).toBeNull();
    expect(screen.getByText('Event Desk')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'desk@example.edu' })).toHaveAttribute(
      'href',
      'mailto:desk@example.edu',
    );
  });

  it('names the institution', () => {
    render(<Footer links={[]} />);
    expect(screen.getAllByText(new RegExp(site.institution)).length).toBeGreaterThan(0);
  });

  it('gives the college address and website, without college phone numbers', () => {
    render(<Footer links={[]} />);

    expect(screen.getByText(/Poosaripatty, Kadayampatty Taluk, Salem – 636305/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'www.rpsit.ac.in' })).toHaveAttribute('href', 'https://www.rpsit.ac.in/');
    expect(document.querySelector('.footer__info a[href^="tel:"]')).toBeNull();
    expect(screen.queryByText(/Admin Office|Admission Cell/)).toBeNull();
  });

  it('lists phone numbers again once they are added back', () => {
    site.college.phones = [{ label: 'Admin Office', numbers: ['93449 72274'] }];
    render(<Footer links={[]} />);

    expect(screen.getByRole('link', { name: '+91 93449 72274' })).toHaveAttribute('href', 'tel:+919344972274');
  });

  it('shows the RPSIT crest instead of the PRAGYA mark', () => {
    const { container } = render(<Footer links={[]} />);

    expect(container.querySelector('img.footer__logo')).toHaveAttribute('src', '/images/rpsit-logo-sm.webp');
  });

  it('puts the map beside the credits, after the contact details', () => {
    const { container } = render(<Footer links={[]} />);

    const blocks = [...container.querySelectorAll('.footer__grid > *')].map((block) => block.className);
    expect(blocks).toEqual(['footer__brand', 'footer__contact', 'footer__more', 'footer__location']);
    expect(container.querySelector('.footer__more .footer__credits')).not.toBeNull();
  });

  it('embeds the campus map lazily and links to it on Google Maps', () => {
    render(<Footer links={[]} />);

    const map = screen.getByTitle(`Map showing ${site.college.name}`);
    expect(map.tagName).toBe('IFRAME');
    expect(map).toHaveAttribute('loading', 'lazy');
    expect(map.getAttribute('src')).toMatch(/^https:\/\/www\.google\.com\/maps\/embed\?pb=/);

    const link = screen.getByRole('link', { name: /Open in Google Maps/ });
    expect(link).toHaveAttribute('href', site.college.map.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('links to the college Instagram', () => {
    render(<Footer links={[]} />);

    expect(screen.getByRole('link', { name: 'Instagram (opens in a new tab)' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/_rpsit_/',
    );
  });

  it('links the credited developer\'s profiles', () => {
    render(<Footer links={[]} />);

    const credits = screen.getByRole('heading', { name: 'Developed by' }).closest('.footer__credits') as HTMLElement;
    expect(within(credits).getByRole('link', { name: 'Mohan Prabu K on GitHub (opens in a new tab)' })).toHaveAttribute(
      'href',
      'https://github.com/MohanPrabu018-K',
    );
  });
});
