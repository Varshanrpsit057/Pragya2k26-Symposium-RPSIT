/**
 * The Store on DynamoDB (two on-demand tables, created by amplify/backend.ts):
 *
 *   Registrations   key registrationId; index "byStatus" (status, submittedAt) for the dashboard
 *   Control         key pk: claims (submission#…, email#…, transaction#…), the ID counter,
 *                   admin sessions and rate-limit counters (both expire by TTL), settings
 *
 * Every rule that keeps the workflow safe is a DynamoDB condition, so it holds across any
 * number of Lambda instances at once.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import type {
  AdminSession,
  ClaimKind,
  CreateResult,
  Expectation,
  Registration,
  RegistrationChanges,
  RegistrationStatus,
  Store,
} from './store';

export const STATUS_INDEX = 'byStatus';
/** The Control table's TTL attribute (seconds since epoch). */
export const TTL_ATTRIBUTE = 'expiresAtEpoch';
const COUNTER_KEY = 'counter#registration';

const isConditionFailure = (error: unknown) =>
  error instanceof Error && (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException');

const claimKey = (kind: ClaimKind, key: string) => `${kind}#${key}`;

export class DynamoStore implements Store {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly tables: { registrations: string; control: string },
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async getRegistration(registrationId: string) {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tables.registrations, Key: { registrationId }, ConsistentRead: true }),
    );
    return (Item as Registration | undefined) ?? null;
  }

  async listRegistrations(status: RegistrationStatus) {
    const items: Registration[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new QueryCommand({
          TableName: this.tables.registrations,
          IndexName: STATUS_INDEX,
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': status },
          ScanIndexForward: false,
          ExclusiveStartKey: start,
        }),
      );
      items.push(...((page.Items ?? []) as Registration[]));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  }

  async findClaim(kind: ClaimKind, key: string) {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tables.control, Key: { pk: claimKey(kind, key) }, ConsistentRead: true }),
    );
    return typeof Item?.registrationId === 'string' ? Item.registrationId : null;
  }

  async nextRegistrationNumber(seed: () => Promise<number>) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { Attributes } = await this.db.send(
          new UpdateCommand({
            TableName: this.tables.control,
            Key: { pk: COUNTER_KEY },
            UpdateExpression: 'SET #n = #n + :one',
            ConditionExpression: 'attribute_exists(#n)',
            ExpressionAttributeNames: { '#n': 'n' },
            ExpressionAttributeValues: { ':one': 1 },
            ReturnValues: 'UPDATED_NEW',
          }),
        );
        return Number(Attributes?.n);
      } catch (error) {
        if (!isConditionFailure(error) || attempt > 0) throw error;
      }
      // First registration ever: start after the highest number already in use.
      await this.ensureCounter(seed);
    }
    throw new Error('Could not take a registration number');
  }

  async ensureCounter(seed: () => Promise<number>) {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tables.control, Key: { pk: COUNTER_KEY }, ConsistentRead: true }),
    );
    if (Item) return;
    const start = await seed();
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.tables.control,
          Item: { pk: COUNTER_KEY, n: start },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (error) {
      // Another instance started the counter first: use theirs.
      if (!isConditionFailure(error)) throw error;
    }
  }

  async createRegistration(registration: Registration): Promise<CreateResult> {
    const claims: [ClaimKind, string][] = [
      ['submission', registration.submissionHash],
      ['email', registration.emailKey],
      ['transaction', registration.transactionKey],
    ];
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tables.registrations,
                Item: registration,
                ConditionExpression: 'attribute_not_exists(registrationId)',
              },
            },
            ...claims.map(([kind, key]) => ({
              Put: {
                TableName: this.tables.control,
                Item: { pk: claimKey(kind, key), registrationId: registration.registrationId, createdAt: registration.submittedAt },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            })),
          ],
        }),
      );
      return { ok: true };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') throw error;
      const reasons = (error as Error & { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
      const conflicts = claims.filter((_, index) => reasons[index + 1]?.Code === 'ConditionalCheckFailed').map(([kind]) => kind);
      // Cancelled for another reason (e.g. a conflicting write in flight): let the caller retry.
      if (!conflicts.length && reasons[0]?.Code !== 'ConditionalCheckFailed') throw error;
      return { ok: false, conflicts };
    }
  }

  async updateRegistration(
    registrationId: string,
    changes: RegistrationChanges,
    { expect = {}, bump = true }: { expect?: Expectation; bump?: boolean } = {},
  ) {
    const names: Record<string, string> = { '#id': 'registrationId' };
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    const removes: string[] = [];
    Object.entries(changes).forEach(([field, value], index) => {
      if (value === undefined) return;
      names[`#f${index}`] = field;
      if (value === null) removes.push(`#f${index}`);
      else {
        values[`:v${index}`] = value;
        sets.push(`#f${index} = :v${index}`);
      }
    });
    if (bump) {
      names['#version'] = 'version';
      values[':one'] = 1;
      sets.push('#version = #version + :one');
    }
    const conditions = ['attribute_exists(#id)'];
    Object.entries(expect).forEach(([field, value], index) => {
      names[`#e${index}`] = field;
      values[`:e${index}`] = value;
      conditions.push(`#e${index} = :e${index}`);
    });
    if (!sets.length && !removes.length) return this.getRegistration(registrationId);

    try {
      const { Attributes } = await this.db.send(
        new UpdateCommand({
          TableName: this.tables.registrations,
          Key: { registrationId },
          UpdateExpression: [sets.length && `SET ${sets.join(', ')}`, removes.length && `REMOVE ${removes.join(', ')}`]
            .filter(Boolean)
            .join(' '),
          ConditionExpression: conditions.join(' AND '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return Attributes as Registration;
    } catch (error) {
      if (isConditionFailure(error)) return null;
      throw error;
    }
  }

  async acquireLease(registrationId: string, until: number, now: number) {
    const leaseId = randomUUID();
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.tables.registrations,
          Key: { registrationId },
          UpdateExpression: 'SET leaseUntil = :until, leaseId = :lease',
          ConditionExpression: 'attribute_exists(registrationId) AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)',
          ExpressionAttributeValues: { ':until': until, ':lease': leaseId, ':now': now },
        }),
      );
      return leaseId;
    } catch (error) {
      if (isConditionFailure(error)) return null;
      throw error;
    }
  }

  async releaseLease(registrationId: string, leaseId: string) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.tables.registrations,
          Key: { registrationId },
          UpdateExpression: 'REMOVE leaseUntil, leaseId',
          ConditionExpression: 'leaseId = :lease',
          ExpressionAttributeValues: { ':lease': leaseId },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  async releaseClaim(kind: ClaimKind, key: string, registrationId: string) {
    try {
      await this.db.send(
        new DeleteCommand({
          TableName: this.tables.control,
          Key: { pk: claimKey(kind, key) },
          ConditionExpression: 'registrationId = :id',
          ExpressionAttributeValues: { ':id': registrationId },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  async putSession(tokenHash: string, session: AdminSession) {
    await this.db.send(
      new PutCommand({
        TableName: this.tables.control,
        Item: { pk: `session#${tokenHash}`, ...session, [TTL_ATTRIBUTE]: Math.ceil(session.expiresAt / 1000) },
      }),
    );
  }

  async getSession(tokenHash: string) {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tables.control, Key: { pk: `session#${tokenHash}` }, ConsistentRead: true }),
    );
    if (!Item) return null;
    return {
      username: String(Item.username),
      credential: String(Item.credential ?? ''),
      createdAt: Number(Item.createdAt),
      expiresAt: Number(Item.expiresAt),
    };
  }

  async deleteSession(tokenHash: string) {
    await this.db.send(new DeleteCommand({ TableName: this.tables.control, Key: { pk: `session#${tokenHash}` } }));
  }

  async hit(key: string, windowMs: number, now: number) {
    const window = Math.floor(now / windowMs);
    const { Attributes } = await this.db.send(
      new UpdateCommand({
        TableName: this.tables.control,
        Key: { pk: `rate#${key}#${window}` },
        UpdateExpression: 'ADD #n :one SET #ttl = :ttl',
        ExpressionAttributeNames: { '#n': 'n', '#ttl': TTL_ATTRIBUTE },
        ExpressionAttributeValues: { ':one': 1, ':ttl': Math.ceil(((window + 1) * windowMs) / 1000) + 3600 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(Attributes?.n ?? 1);
  }

  async getSetting(name: string) {
    const { Item } = await this.db.send(new GetCommand({ TableName: this.tables.control, Key: { pk: `setting#${name}` } }));
    return typeof Item?.value === 'string' ? Item.value : null;
  }

  async putSetting(name: string, value: string) {
    await this.db.send(new PutCommand({ TableName: this.tables.control, Item: { pk: `setting#${name}`, value } }));
  }
}
