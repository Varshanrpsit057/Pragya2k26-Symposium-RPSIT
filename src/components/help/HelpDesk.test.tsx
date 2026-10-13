import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { site } from '../../content/site';
import { HelpDeskLine } from './HelpDeskLine';

describe('the help desk', () => {
  it('puts its number in one line wherever help may be needed', () => {
    render(<HelpDeskLine />);
    expect(screen.getByText('Need help? Call the help desk:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: site.helpDesk.phones[0].phone })).toBeInTheDocument();
  });
});
