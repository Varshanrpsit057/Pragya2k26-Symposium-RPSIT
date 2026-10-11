/**
 * The DynamoDB store's requests, checked on the wire: the real AWS SDK client marshals each
 * call, and a stub answers it instead of DynamoDB. The conditions themselves are DynamoDB's
 * to enforce; these tests make sure each write carries the right ones.
 */
import { Readable } from 'node:stream';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import { DynamoStore } from './dynamoStore';
import type { Registration, StaffAccount } from './store';

type Answer = { status?: number; body: unknown };

function stubStore(answers: Answer[] = []) {
  const requests: { target: string; body: Record<string, unknown> }[] = [];
  const client = new DynamoDBClient({
    region: 'ap-south-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
    requestHandler: {
      handle: async (request: { headers: Record<string, string>; body: string }) => {
        requests.push({ target: request.headers['x-amz-target'].split('.')[1], body: JSON.parse(String(request.body)) });
        const answer = answers.shift() ?? { body: {} };
        return {
          response: {
            statusCode: answer.status ?? 200,
            headers: { 'content-type': 'application/x-amz-json-1.0' },
            body: Readable.from([Buffer.from(JSON.stringify(answer.body))]),
          },
        };
      },
    } as never,
  });
  return { store: new DynamoStore({ registrations: 'Registrations', control: 'Control' }, client), requests };
}

const conditionFailed = {
  status: 400,
  body: { __type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException', message: 'The conditional request failed' },
};

const cancelled = (codes: string[]) => ({
  status: 400,
  body: {
    __type: 'com.amazonaws.dynamodb.v20120810#TransactionCanceledException',
    message: 'Transaction cancelled',
    CancellationReasons: codes.map((Code) => ({ Code })),
  },
});

const registration = (overrides: Partial<Registration> = {}): Registration => ({
  registrationId: '262001',
  source: 'ONSITE',
  status: 'APPROVED',
  submittedAt: '2026-10-17T04:00:00.000Z',
  submissionHash: 'hash',
  record: {
    participant: { name: 'Nila R', department: 'CSE', college: 'Sona', year: '2nd Year', phone: '9840000001', email: 'nila@example.com' },
    technicalEvents: ['COGNIX'],
    payment: { gatePassAmount: 100, transactionId: '' },
    eventRegistration: { eventCount: 1, feePerEvent: 50, totalEventFee: 50 },
  },
  eventIds: ['cognix'],
  emailKey: 'nila@example.com',
  transactionKey: '',
  phoneKey: '9840000001',
  pdfStatus: 'NOT_STARTED',
  emailStatus: 'NOT_SENT',
  emailAttempts: 0,
  sheetRow: false,
  version: 1,
  sheetVersion: 0,
  syncAttempts: 0,
  ...overrides,
});

describe('DynamoStore requests', () => {
  it('takes on-site numbers from their own counter', async () => {
    const { store, requests } = stubStore([{ body: { Attributes: { n: { N: '7' } } } }]);
    expect(await store.nextRegistrationNumber(async () => 0, 'onsite')).toBe(7);
    expect(requests[0]).toMatchObject({
      target: 'UpdateItem',
      body: { TableName: 'Control', Key: { pk: { S: 'counter#onsite' } }, ConditionExpression: 'attribute_exists(#n)' },
    });
  });

  it('claims email and phone with the registration, all or nothing, and no empty transaction', async () => {
    const { store, requests } = stubStore([{ body: {} }]);
    expect(await store.createRegistration(registration())).toEqual({ ok: true });
    type Put = { TableName: string; Item: { pk?: { S: string } }; ConditionExpression: string };
    const puts = (requests[0].body.TransactItems as { Put: Put }[]).map((item) => item.Put);
    expect(requests[0].target).toBe('TransactWriteItems');
    expect(puts.map((put) => put.Item.pk?.S ?? 'registration')).toEqual(['registration', 'submission#hash', 'email#nila@example.com', 'phone#9840000001']);
    expect(puts[0].ConditionExpression).toBe('attribute_not_exists(registrationId)');
    puts.slice(1).forEach((put) => expect(put.ConditionExpression).toBe('attribute_not_exists(pk)'));
  });

  it('reports which claim was already taken, or that only the ID was', async () => {
    const { store } = stubStore([cancelled(['None', 'None', 'None', 'ConditionalCheckFailed']), cancelled(['ConditionalCheckFailed', 'None', 'None', 'None'])]);
    expect(await store.createRegistration(registration())).toEqual({ ok: false, conflicts: ['phone'] });
    expect(await store.createRegistration(registration())).toEqual({ ok: false, conflicts: [] });
  });

  it('changes a registration only if its version is still the one read', async () => {
    const { store, requests } = stubStore([conditionFailed]);
    expect(await store.updateRegistration('262001', { participation: {} }, { expect: { version: 4 } })).toBeNull();
    const { body } = requests[0];
    expect(body.ConditionExpression).toBe('attribute_exists(#id) AND #e0 = :e0');
    expect(body.ExpressionAttributeNames).toMatchObject({ '#e0': 'version', '#version': 'version' });
    expect(body.ExpressionAttributeValues).toMatchObject({ ':e0': { N: '4' }, ':one': { N: '1' } });
    expect(body.UpdateExpression).toMatch(/#version = #version \+ :one/);
  });

  it('stores staff accounts and results only over the revision that was read', async () => {
    const account: StaffAccount = {
      username: 'desk1',
      displayName: 'Desk One',
      role: 'DESK',
      eventIds: [],
      passwordHash: 'scrypt-hash',
      active: true,
      createdAt: 'now',
      createdBy: 'owner',
      updatedAt: 'now',
      updatedBy: 'owner',
      passwordChangedAt: 'now',
      revision: 1,
    };
    const { store, requests } = stubStore([{ body: {} }, conditionFailed, { body: {} }]);
    expect(await store.saveStaff(account, 0)).toBe(true);
    expect(requests[0].body).toMatchObject({ TableName: 'Control', Item: { pk: { S: 'staff#desk1' } }, ConditionExpression: 'attribute_not_exists(pk)' });
    expect(await store.saveStaff({ ...account, revision: 4 }, 3)).toBe(false);
    expect(requests[1].body).toMatchObject({ ConditionExpression: '#revision = :expected', ExpressionAttributeValues: { ':expected': { N: '3' } } });
    expect(await store.saveEventResult({ eventId: 'cognix', status: 'DRAFT', revision: 1, winners: { first: [], second: [], third: [] } }, 0)).toBe(true);
    expect(requests[2].body).toMatchObject({ Item: { pk: { S: 'result#cognix' } } });
  });

  it('lists staff accounts with a filtered scan, without their keys', async () => {
    const { store, requests } = stubStore([
      { body: { Items: [{ pk: { S: 'staff#b' }, username: { S: 'b' } }], LastEvaluatedKey: { pk: { S: 'staff#b' } } } },
      { body: { Items: [{ pk: { S: 'staff#a' }, username: { S: 'a' } }] } },
    ]);
    const accounts = await store.listStaff();
    expect(accounts.map((account) => account.username)).toEqual(['a', 'b']);
    expect(accounts[0]).not.toHaveProperty('pk');
    expect(requests[0].body).toMatchObject({ FilterExpression: 'begins_with(pk, :prefix)', ExpressionAttributeValues: { ':prefix': { S: 'staff#' } } });
    expect(requests[1].body).toMatchObject({ ExclusiveStartKey: { pk: { S: 'staff#b' } } });
  });
});
