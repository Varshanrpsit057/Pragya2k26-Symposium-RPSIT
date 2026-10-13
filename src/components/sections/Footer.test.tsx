import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { crew } from '../../content/crew';
import { site } from '../../content/site';
import { Footer } from './Footer';

const originalEmail = site.email;
const originalPhones = site.college.phones;

afterEach(() => {
  site.email = originalEmail;
  site.college.phones = originalPhones;
});

describe('Footer', () => {
  it('credits the whole dev crew under "Developed by", each with their role and class', () => {
    render(<Footer links={[]} />);

    const credits = screen.getByRole('heading', { name: 'Developed by' }).closest('.footer__credits') as HTMLElement;
    const credited = crew.filter((member) => member.credited);
    expect(credited.map((member) => member.name)).toEqual(['Mohan Prabu K', 'Varshan C', 'Barath S', 'Sivakasi N']);
    expect(within(credits).getAllByRole('listitem')).toHaveLength(credited.length);
    for (const member of credited) {
      expect(within(credits).getByText(member.name)).toBeInTheDocument();
      expect(within(credits).getByText(`${member.role} · ${member.study}`)).toBeInTheDocument();
    }
  });

  it('leaves the Dev Crew button to the navigation', () => {
    render(<Footer links={[]} />);

    expect(screen.queryByRole('button', { name: 'Meet the Dev Crew' })).toBeNull();
  });

  it('gives the help desk for any help, with no coordinator contact block', () => {
    render(<Footer links={[]} />);

    expect(screen.getByRole('heading', { name: 'Help desk' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Coordinator contact' })).toBeNull();
    expect(screen.queryByText('Overall Student Coordinator · III Year AI&DS')).toBeNull();
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

  it('shows the RPSIT lockup (crest, name, autonomous status) above the fest’s name', () => {
    const { container } = render(<Footer links={[]} />);

    const lockup = container.querySelector('.footer__brand .college-lockup') as HTMLElement;
    expect(lockup.querySelector('img')).toHaveAttribute('src', '/images/rpsit-crest.webp');
    expect(lockup).toHaveTextContent(`${site.college.name}${site.college.status}`);
    expect(container.querySelector('.footer__wordmark')).toHaveTextContent('Infinite Techfest’26');
  });

  it('puts the credits after the contact details, and no map (the page loads without Google Maps)', () => {
    const { container } = render(<Footer links={[]} />);

    const blocks = [...container.querySelectorAll('.footer__grid > *')].map((block) => block.className);
    expect(blocks).toEqual(['footer__brand', 'footer__contact', 'footer__more']);
    expect(container.querySelector('.footer__more .footer__credits')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Location' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Google Maps/ })).toBeNull();
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
