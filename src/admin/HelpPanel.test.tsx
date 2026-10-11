import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HelpRequest } from '../lib/help';
import { ROLE_PERMISSIONS, type SessionInfo } from '../lib/staff';
import { HelpDialog } from './HelpDialog';
import { HelpPanel } from './HelpPanel';

const session: SessionInfo = {
  username: 'web1',
  displayName: 'Web One',
  role: 'SUPPORT',
  kind: 'staff',
  eventIds: [],
  permissions: [...ROLE_PERMISSIONS.SUPPORT],
  expiresAt: '2026-10-17T12:00:00.000Z',
  serverTime: '2026-10-17T04:00:00.000Z',
  phase: 'onsite',
  eventDayStarted: true,
  schedule: { onlineClosesAt: null, onsiteOpensAt: null, onsiteClosesAt: null },
  fees: { gatePass: 100, perEvent: 50 },
  passByEmail: false,
  deskNumber: null,
};

const request: HelpRequest = {
  id: 'abc123-xyz',
  createdAt: '2026-10-17T04:00:00.000Z',
  category: 'WRONG_DETAILS',
  message: 'Wrong college for 262001',
  name: 'Desk One',
  contact: null,
  username: 'desk1',
  registrationId: '262001',
  page: 'Registration desk',
  status: 'OPEN',
};

const json = (body: object) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('help requests', () => {
  it('lets the web team reply to a coordinator and mark the request resolved', async () => {
    const sent: unknown[] = [];
    let stored = request;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (init?.body) {
        const body = JSON.parse(String(init.body)) as { reply?: string; status?: HelpRequest['status'] };
        sent.push(body);
        stored = {
          ...stored,
          ...(body.status && { status: body.status }),
          replies: [...(stored.replies ?? []), ...(body.reply ? [{ by: 'Web One', at: '2026-10-17T04:05:00.000Z', text: body.reply }] : [])],
        };
        return json({ success: true, request: stored });
      }
      return json({ success: true, requests: String(input).endsWith('/api/admin/help') ? [stored] : [] });
    });
    render(<HelpPanel token="t" session={session} onSignedOut={() => undefined} />);
    const item = (await screen.findByText('Wrong college for 262001')).closest('li') as HTMLElement;
    expect(item).toHaveTextContent('From Desk One (desk1) · in Registration desk · about 262001');
    fireEvent.change(within(item).getByLabelText('Reply to Desk One'), { target: { value: 'Fixed: the college is corrected.' } });
    fireEvent.click(within(item).getByRole('button', { name: 'Reply and mark resolved' }));
    await waitFor(() => expect(sent).toEqual([{ status: 'RESOLVED', reply: 'Fixed: the college is corrected.' }]));
  });

  it('shows a coordinator the replies to their earlier requests under Contact admin', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ success: true, requests: [{ ...request, replies: [{ by: 'Web One', at: '2026-10-17T04:05:00.000Z', text: 'Fixed: the college is corrected.' }] }] }),
    );
    render(<HelpDialog token="t" signedInAs="Desk One" username="desk1" onClose={() => undefined} />);
    const earlier = await screen.findByRole('region', { name: 'Your earlier requests' });
    expect(earlier).toHaveTextContent('Web One: Fixed: the college is corrected.');
    // Seen now: the badge on Contact admin goes.
    expect(localStorage.getItem('pragya-help-seen-desk1')).not.toBeNull();
  });
});
