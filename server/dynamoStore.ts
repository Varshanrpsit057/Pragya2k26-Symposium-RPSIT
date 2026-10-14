/**
 * The Store on DynamoDB (two on-demand tables, created by amplify/backend.ts):
 *
 *   Registrations   key registrationId; index "byStatus" (status, submittedAt) for the dashboard
 *   Control         key pk: claims (submission#…, email#…, transaction#…, phone#…), the ID
 *                   counters (online and on-site), staff accounts (staff#…), event results
 *                   (result#…), admin sessions and rate-limit counters (both expire by TTL),
 *                   settings
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
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import {
  claimsOf,
  type AdminSession,
  type AuditEntry,
  type ClaimKind,
  type CounterName,
  type CreateResult,
  type EventResult,
  type Expectation,
  type HelpRequest,
  type Registration,
  type RegistrationChanges,
  type RegistrationStatus,
  type StaffAccount,
  type Store,
} from './store';

export const STATUS_INDEX = 'byStatus';
/** The Control table's TTL attribute (seconds since epoch). */
export const TTL_ATTRIBUTE = 'expiresAtEpoch';
/** counter#registration (online, 261NNN) and counter#onsite (262NNN). */
const counterKey = (counter: CounterName) => `counter#${counter}`;
const STAFF_PREFIX = 'staff#';
const RESULT_PREFIX = 'result#';
const HELP_PREFIX = 'help#';
const AUDIT_PREFIX = 'audit#';

const isConditionFailure = (error: unknown) =>
  error instanceof Error && (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException');

const claimKey = (kind: ClaimKind, key: string) => `${kind}#${key}`;

/** An item from the Control table without its key. */
function withoutKey<T>(item: Record<string, unknown>): T {
  const { pk: _pk, ...rest } = item;
  void _pk;
  return rest as T;
}

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

  async nextRegistrationNumber(seed: () => Promise<number>, counter: CounterName = 'registration') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { Attributes } = await this.db.send(
          new UpdateCommand({
            TableName: this.tables.control,
            Key: { pk: counterKey(counter) },
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
      await this.ensureCounter(seed, counter);
    }
    throw new Error('Could not take a registration number');
  }

  async setCounter(counter: CounterName, value: number) {
    await this.db.send(new PutCommand({ TableName: this.tables.control, Item: { pk: counterKey(counter), n: value } }));
  }

  async ensureCounter(seed: () => Promise<number>, counter: CounterName = 'registration') {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tables.control, Key: { pk: counterKey(counter) }, ConsistentRead: true }),
    );
    if (Item) return;
    const start = await seed();
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.tables.control,
          Item: { pk: counterKey(counter), n: start },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (error) {
      // Another instance started the counter first: use theirs.
      if (!isConditionFailure(error)) throw error;
    }
  }

  async createRegistration(registration: Registration): Promise<CreateResult> {
    const claims = claimsOf(registration);
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

  async claim(kind: ClaimKind, key: string, registrationId: string) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.tables.control,
          Item: { pk: claimKey(kind, key), registrationId, createdAt: new Date().toISOString() },
          ConditionExpression: 'attribute_not_exists(pk) OR registrationId = :id',
          ExpressionAttributeValues: { ':id': registrationId },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async deleteRegistration(registrationId: string, version: number) {
    try {
      await this.db.send(
        new DeleteCommand({
          TableName: this.tables.registrations,
          Key: { registrationId },
          ConditionExpression: '#version = :version',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':version': version },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
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
      kind: Item.kind === 'staff' ? ('staff' as const) : ('owner' as const),
      credential: String(Item.credential ?? ''),
      createdAt: Number(Item.createdAt),
      expiresAt: Number(Item.expiresAt),
      ...(Item.deskNumber !== undefined && { deskNumber: Number(Item.deskNumber) }),
    };
  }

  async deleteSession(tokenHash: string) {
    await this.db.send(new DeleteCommand({ TableName: this.tables.control, Key: { pk: `session#${tokenHash}` } }));
  }

  async listSessions() {
    return (await this.scanPrefix<Record<string, unknown>>('session#')).map((item) => ({
      username: String(item.username),
      kind: item.kind === 'staff' ? ('staff' as const) : ('owner' as const),
      credential: typeof item.credential === 'string' ? item.credential : '',
      createdAt: Number(item.createdAt),
      expiresAt: Number(item.expiresAt),
      ...(item.deskNumber !== undefined && { deskNumber: Number(item.deskNumber) }),
    }));
  }

  async getStaff(username: string) {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tables.control, Key: { pk: `${STAFF_PREFIX}${username}` }, ConsistentRead: true }),
    );
    return Item ? withoutKey<StaffAccount>(Item) : null;
  }

  /** A few staff accounts among the Control table's items: a filtered scan is plenty. */
  async listStaff() {
    const accounts: StaffAccount[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new ScanCommand({
          TableName: this.tables.control,
          FilterExpression: 'begins_with(pk, :prefix)',
          ExpressionAttributeValues: { ':prefix': STAFF_PREFIX },
          ConsistentRead: true,
          ExclusiveStartKey: start,
        }),
      );
      accounts.push(...(page.Items ?? []).map((item) => withoutKey<StaffAccount>(item)));
      start = page.LastEvaluatedKey;
    } while (start);
    return accounts.sort((a, b) => a.username.localeCompare(b.username));
  }

  async saveStaff(account: StaffAccount, expectedRevision: number) {
    return this.putRevised(`${STAFF_PREFIX}${account.username}`, account, expectedRevision);
  }

  async deleteStaff(username: string, expectedRevision: number) {
    try {
      await this.db.send(
        new DeleteCommand({
          TableName: this.tables.control,
          Key: { pk: `${STAFF_PREFIX}${username}` },
          ConditionExpression: '#revision = :revision',
          ExpressionAttributeNames: { '#revision': 'revision' },
          ExpressionAttributeValues: { ':revision': expectedRevision },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }

  async noteStaffSignIn(username: string, at: string) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.tables.control,
          Key: { pk: `${STAFF_PREFIX}${username}` },
          UpdateExpression: 'SET lastSignInAt = :at',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':at': at },
        }),
      );
    } catch (error) {
      // Deleted meanwhile: nothing to record.
      if (!(error instanceof Error && error.name === 'ConditionalCheckFailedException')) throw error;
    }
  }

  async getEventResult(eventId: string) {
    const { Item } = await this.db.send(
      new GetCommand({ TableName: this.tables.control, Key: { pk: `${RESULT_PREFIX}${eventId}` }, ConsistentRead: true }),
    );
    return Item ? withoutKey<EventResult>(Item) : null;
  }

  async saveEventResult(result: EventResult, expectedRevision: number) {
    return this.putRevised(`${RESULT_PREFIX}${result.eventId}`, result, expectedRevision);
  }

  async deleteEventResult(eventId: string) {
    await this.db.send(new DeleteCommand({ TableName: this.tables.control, Key: { pk: `${RESULT_PREFIX}${eventId}` } }));
  }

  /** Puts an item whose stored `revision` must still be `expected` (0: must not exist yet). */
  private async putRevised(pk: string, item: object, expected: number) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.tables.control,
          Item: { ...item, pk },
          ...(expected === 0
            ? { ConditionExpression: 'attribute_not_exists(pk)' }
            : { ConditionExpression: '#revision = :expected', ExpressionAttributeNames: { '#revision': 'revision' }, ExpressionAttributeValues: { ':expected': expected } }),
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
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

  /** Every Control item whose key starts with `prefix` (help requests, audit entries: a few dozen). */
  private async scanPrefix<T>(prefix: string): Promise<T[]> {
    const items: T[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new ScanCommand({
          TableName: this.tables.control,
          FilterExpression: 'begins_with(pk, :prefix)',
          ExpressionAttributeValues: { ':prefix': prefix },
          ConsistentRead: true,
          ExclusiveStartKey: start,
        }),
      );
      items.push(...(page.Items ?? []).map((item) => withoutKey<T>(item)));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  }

  async getHelpRequest(id: string) {
    const { Item } = await this.db.send(new GetCommand({ TableName: this.tables.control, Key: { pk: `${HELP_PREFIX}${id}` }, ConsistentRead: true }));
    return Item ? withoutKey<HelpRequest>(Item) : null;
  }

  async listHelpRequests() {
    return (await this.scanPrefix<HelpRequest>(HELP_PREFIX)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteHelpRequest(id: string) {
    await this.db.send(new DeleteCommand({ TableName: this.tables.control, Key: { pk: `${HELP_PREFIX}${id}` } }));
  }

  async saveHelpRequest(request: HelpRequest) {
    await this.db.send(new PutCommand({ TableName: this.tables.control, Item: { pk: `${HELP_PREFIX}${request.id}`, ...request } }));
  }

  async addAuditEntry(entry: AuditEntry) {
    await this.db.send(
      new PutCommand({ TableName: this.tables.control, Item: { pk: `${AUDIT_PREFIX}${entry.at}#${entry.registrationId}`, ...entry } }),
    );
  }

  async listAuditEntries() {
    return (await this.scanPrefix<AuditEntry>(AUDIT_PREFIX)).sort((a, b) => b.at.localeCompare(a.at));
  }
}
