import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { site } from '../../content/site';
import { HelpDeskLine } from './HelpDeskLine';
import { HelpDeskSection } from './HelpDeskSection';

describe('the help desk', () => {
  it('has its own section: numbers to call or WhatsApp, where it is, and quick answers', () => {
    render(<HelpDeskSection />);
    const section = screen.getByRole('region', { name: 'Need help? Call us' });
    const phone = site.helpDesk.phones[0].phone;
    for (const link of within(section).getAllByRole('link', { name: /^Call$|^\+91/ })) expect(link).toHaveAttribute('href', `tel:${phone.replace(/[^\d+]/g, '')}`);
    expect(within(section).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', `https://wa.me/${phone.replace(/\D/g, '')}`);
    expect(section).toHaveTextContent(site.helpDesk.where);
    expect(within(section).getByText('Where do I get my participant pass?')).toBeInTheDocument();
    expect(section).toHaveTextContent('passes are not emailed');
    expect(section).toHaveTextContent('If you register at the desk on the event day, there is no pass');
    expect(within(section).getByRole('link', { name: /Student login/ })).toHaveAttribute('href', '/landing/student/');
  });

  it('puts its number in one line wherever help may be needed', () => {
    render(<HelpDeskLine />);
    expect(screen.getByText('Need help? Call the help desk:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: site.helpDesk.phones[0].phone })).toBeInTheDocument();
  });
});
