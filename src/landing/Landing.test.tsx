import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';

describe('the front door (pragya2k26.online)', () => {
  it('names the fest and its day, and takes staff to sign in', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Infinite\s*Techfest’26/);
    expect(screen.getByText('17 October 2026', { selector: '.landing-date' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Staff sign in' })).toHaveAttribute('href', '/landing/admin/');
  });

  it('lists every department’s staff page', () => {
    render(<Landing />);
    const list = screen.getByRole('region', { name: 'Department staff pages' });
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['cse', 'aids', 'it', 'ece', 'cys', 'eee', 'mech', 'sh'].map((code) => `/landing/${code}/admin/`));
    expect(within(list).getByRole('link', { name: /MECH\s*Mechanical Engineering/ })).toBeInTheDocument();
  });

  it('tells students where to register, and has no events button until the events website is set', () => {
    render(<Landing />);
    expect(screen.getByRole('region', { name: 'Taking part?' })).toHaveTextContent('Register at your department’s desk on campus on 17 October 2026.');
    expect(screen.queryByRole('link', { name: 'Events and route map' })).toBeNull();
  });
});
