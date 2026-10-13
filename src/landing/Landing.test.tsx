import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';

describe('the front door (pragya2k26.online)', () => {
  it('names the fest and its day, sends students to register and staff to sign in', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Infinite\s*Techfest’26/);
    expect(screen.getByText('17 October 2026', { selector: '.landing-date' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register now' })).toHaveAttribute('href', '/register/');
    for (const link of screen.getAllByRole('link', { name: 'My registration ID' })) expect(link).toHaveAttribute('href', '/register/?my');
    expect(screen.getAllByRole('link', { name: 'Staff sign in' })[0]).toHaveAttribute('href', '/landing/admin/');
  });

  it('lists every department’s staff page', () => {
    render(<Landing />);
    const list = screen.getByRole('region', { name: 'Department staff pages' });
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['cse', 'aids', 'it', 'ece', 'cys', 'eee', 'mech', 'sh'].map((code) => `/landing/${code}/admin/`));
    expect(within(list).getByRole('link', { name: /MECH\s*Mechanical Engineering/ })).toBeInTheDocument();
  });

  it('tells students the three steps: register on the phone, verify at a desk, events at the venue', () => {
    render(<Landing />);
    const steps = screen.getByRole('region', { name: 'Taking part?' });
    expect(steps).toHaveTextContent('Register on your phone');
    expect(steps).toHaveTextContent('Verify your payment at any registration desk');
    expect(steps).toHaveTextContent('Register for events at each event’s venue, in any department');
    expect(screen.queryByRole('link', { name: 'Events and route map' })).toBeNull();
  });

  it('ends with PRAGYA’s contact, location and Dev Crew, coordinated by the AI&DS department', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { name: 'Developed by' })).toBeInTheDocument();
    for (const name of ['Mohan Prabu K', 'Varshan C', 'Barath S', 'Sivakasi N']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Location' })).toBeInTheDocument();
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
});
