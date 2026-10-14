import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';

describe('the front door (pragya2k26.online)', () => {
  it('names the fest and its day, and sends students to register', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Infinite\s*Techfest’26/);
    expect(screen.getByText('On-site Registration Portal')).toBeInTheDocument();
    expect(screen.getByText('17 October 2026', { selector: '.landing-date' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register now' })).toHaveAttribute('href', '/register/');
    for (const link of screen.getAllByRole('link', { name: 'My registration ID' })) expect(link).toHaveAttribute('href', '/register/?my');
  });

  it('links to no staff page: staff open /landing/admin/ by its address', () => {
    const { container } = render(<Landing />);
    expect(screen.queryByRole('link', { name: 'Staff sign in' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Department staff pages' })).toBeNull();
    expect(container.querySelector('a[href*="/admin"]')).toBeNull();
  });

  it('tells students the three steps: register on the phone, pay by UPI there or in cash at the desk, events at the venue', () => {
    render(<Landing />);
    const steps = screen.getByRole('region', { name: 'Taking part?' });
    expect(steps).toHaveTextContent('Register on your phone');
    expect(steps).toHaveTextContent('by UPI right after registering (scan the QR code and send the UTR), or in cash at your department’s registration desk');
    expect(steps).toHaveTextContent('your mobile number and email find it');
    expect(steps).toHaveTextContent('Register for events at each event’s venue, in your department');
  });

  it('lets students explore every department’s events on the events website, in a new tab', () => {
    render(<Landing />);
    const explore = screen.getByRole('region', { name: 'Explore the events' });
    const links = within(explore).getAllByRole('link');
    // A card for each of the 8 departments, then Explore all events.
    expect(links).toHaveLength(9);
    for (const link of [...links, screen.getByRole('link', { name: 'Explore events' })]) {
      expect(link).toHaveAttribute('href', 'https://infinite-techfest-2026.vercel.app');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(within(explore).getByRole('link', { name: /^CSE\s*Computer Science and Engineering\s*6 events$/ })).toBeInTheDocument();
    expect(within(explore).getByRole('link', { name: /Explore all events.*opens in a new tab/ })).toBeInTheDocument();
  });

  it('ends with PRAGYA’s contact and Dev Crew (no map), coordinated by the AI&DS department', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { name: 'Developed by' })).toBeInTheDocument();
    for (const name of ['Mohan Prabu K', 'Varshan C', 'Barath S', 'Sivakasi N']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Location' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Follow Us' })).toBeInTheDocument();
    expect(screen.getByText(/Overall coordinated by the/)).toHaveTextContent('Overall coordinated by the Department of Artificial Intelligence and Data Science');
  });

  it('opens the 8 departments in a pop-up from Register now; each goes to its registration form', () => {
    render(<Landing />);
    fireEvent.click(screen.getByRole('link', { name: 'Register now' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose your department' });
    const links = within(dialog).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['CSE', 'AIDS', 'IT', 'ECE', 'CYS', 'EEE', 'MECH', 'SH'].map((code) => `/register/?dept=${code}`));
    expect(within(dialog).getByRole('link', { name: /^AI&DS/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /^CYBER/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /^S&H/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the pop-up from the × in its corner', () => {
    render(<Landing />);
    fireEvent.click(screen.getByRole('link', { name: 'Register now' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose your department' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
