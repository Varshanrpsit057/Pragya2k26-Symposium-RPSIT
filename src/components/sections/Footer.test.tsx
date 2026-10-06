import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { crew } from '../../content/crew';
import { site } from '../../content/site';
import { SiteModalsProvider } from '../modal/SiteModals';
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
  it('opens the Dev Crew from the incognito button beside "Developed by"', () => {
    render(
      <SiteModalsProvider>
        <Footer links={[]} />
      </SiteModalsProvider>,
    );

    expect(screen.queryByRole('dialog', { name: 'Dev Crew' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Meet the Dev Crew' }));
    expect(screen.getByRole('dialog', { name: 'Dev Crew' })).toHaveAttribute('open');
  });

  it('shows each developer with their role and class', () => {
    render(<Footer links={[]} />);

    expect(screen.getByText('Senior Developer · III Year – AI&DS')).toBeInTheDocument();
    expect(screen.getByText('Frontend Developer · III Year – AI&DS')).toBeInTheDocument();
    expect(screen.getByText('Backend Developer · III Year – AI&DS')).toBeInTheDocument();
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

  it('gives the college address and website, without phone numbers', () => {
    render(<Footer links={[]} />);

    expect(screen.getByText(/Poosaripatty, Kadayampatty Taluk, Salem – 636305/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'www.rpsit.ac.in' })).toHaveAttribute('href', 'https://www.rpsit.ac.in/');
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
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

  it('credits the developers with their profiles', () => {
    render(<Footer links={[]} />);

    const credits = screen.getByRole('heading', { name: 'Developed by' }).closest('.footer__credits') as HTMLElement;
    crew.forEach((member) => expect(within(credits).getByText(member.name)).toBeInTheDocument());
    expect(within(credits).getByRole('link', { name: 'Barath S on GitHub (opens in a new tab)' })).toHaveAttribute(
      'href',
      'https://github.com/Barath-S-07',
    );
  });
});
