/**
 * The fest store on DynamoDB (the FestRecords table; layout in festStore.ts). Every rule is a
 * DynamoDB condition, so it holds across any number of Lambda instances at once.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { FestRegistration, FestResult, FestSource } from '../src/lib/fest';
import { ID_RANGES } from '../src/lib/fest';
import type { FestChanges, FestCreate, FestStore } from './festStore';

export const FEST_INDEX = 'byDept';

const pk = (dept: string) => `D#${dept}`;
const isConditionFailure = (error: unknown) =>
  error instanceof Error && (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException');

function strip<T>(item: Record<string, unknown>): T {
  const { pk: _pk, sk: _sk, kind: _kind, ...rest } = item;
  void _pk;
  void _sk;
  void _kind;
  return rest as T;
}

export class DynamoFestStore implements FestStore {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async changes(dept: string, since: string): Promise<FestChanges> {
    const result: FestChanges = { registrations: [], results: [] };
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: FEST_INDEX,
          KeyConditionExpression: since ? '#dept = :dept AND #u >= :since' : '#dept = :dept',
          ExpressionAttributeNames: { '#dept': 'dept', ...(since && { '#u': 'u' }) },
          ExpressionAttributeValues: { ':dept': dept, ...(since && { ':since': since }) },
          ExclusiveStartKey: start,
        }),
      );
      for (const item of page.Items ?? []) {
        if (item.kind === 'R') result.registrations.push(strip<FestRegistration>(item));
        else if (item.kind === 'E') result.results.push(strip<FestResult>(item));
      }
      start = page.LastEvaluatedKey;
    } while (start);
    return result;
  }

  async getRegistration(dept: string, id: string) {
    const { Item } = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: pk(dept), sk: `R#${id}` }, ConsistentRead: true }));
    return Item ? strip<FestRegistration>(Item) : null;
  }

  async createRegistration(registration: FestRegistration, submissionId: string | null): Promise<FestCreate> {
    const { dept, id, phone } = registration;
    const notThere = 'attribute_not_exists(pk)';
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            ...(submissionId ? [{ Put: { TableName: this.table, Item: { pk: pk(dept), sk: `X#${submissionId}`, id }, ConditionExpression: notThere } }] : []),
            { Put: { TableName: this.table, Item: { pk: pk(dept), sk: `P#${phone}`, id }, ConditionExpression: notThere } },
            { Put: { TableName: this.table, Item: { pk: pk(dept), sk: `R#${id}`, kind: 'R', ...registration }, ConditionExpression: notThere } },
          ],
        }),
      );
      return { created: true };
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      if (submissionId) {
        const existing = await this.findSubmission(dept, submissionId);
        if (existing) return { created: false, reason: 'submission', existingId: existing };
      }
      const holder = await this.findPhone(dept, phone);
      if (holder) return { created: false, reason: 'phone', existingId: holder };
      return { created: false, reason: 'id', existingId: null };
    }
  }

  async saveRegistration(registration: FestRegistration, expected: number, phone?: { from: string; to: string }) {
    const { dept, id } = registration;
    const put = {
      Put: {
        TableName: this.table,
        Item: { pk: pk(dept), sk: `R#${id}`, kind: 'R', ...registration },
        ConditionExpression: '#v = :expected',
        ExpressionAttributeNames: { '#v': 'v' },
        ExpressionAttributeValues: { ':expected': expected },
      },
    };
    const moves = phone && phone.from !== phone.to;
    try {
      if (!moves) {
        await this.db.send(new PutCommand(put.Put));
        return true;
      }
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            put,
            ...(phone.from
              ? [
                  {
                    Delete: {
                      TableName: this.table,
                      Key: { pk: pk(dept), sk: `P#${phone.from}` },
                      ConditionExpression: 'attribute_not_exists(pk) OR id = :id',
                      ExpressionAttributeValues: { ':id': id },
                    },
                  },
                ]
              : []),
            ...(phone.to ? [{ Put: { TableName: this.table, Item: { pk: pk(dept), sk: `P#${phone.to}`, id }, ConditionExpression: 'attribute_not_exists(pk)' } }] : []),
          ],
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  private async claim(dept: string, sk: string) {
    const { Item } = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: pk(dept), sk }, ConsistentRead: true }));
    return typeof Item?.id === 'string' ? Item.id : null;
  }

  findPhone(dept: string, phone: string) {
    return this.claim(dept, `P#${phone}`);
  }

  findSubmission(dept: string, submissionId: string) {
    return this.claim(dept, `X#${submissionId}`);
  }

  async getResult(dept: string, eventId: string) {
    const { Item } = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: pk(dept), sk: `E#${eventId}` }, ConsistentRead: true }));
    return Item ? strip<FestResult>(Item) : null;
  }

  async saveResult(result: FestResult, expected: number) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: pk(result.dept), sk: `E#${result.eventId}`, kind: 'E', ...result },
          ConditionExpression: expected === 0 ? 'attribute_not_exists(pk)' : '#v = :expected',
          ...(expected !== 0 && { ExpressionAttributeNames: { '#v': 'v' }, ExpressionAttributeValues: { ':expected': expected } }),
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async takeNumbers(dept: string, source: FestSource, count: number) {
    const { Attributes } = await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: pk(dept), sk: `C#${source}` },
        UpdateExpression: 'SET #next = if_not_exists(#next, :first) + :count',
        ExpressionAttributeNames: { '#next': 'next' },
        ExpressionAttributeValues: { ':first': ID_RANGES[source].first, ':count': count },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(Attributes?.next) - count;
  }

  async claimTxn(dept: string, txn: string, id: string) {
    const key = { pk: pk(dept), sk: `T#${txn.toUpperCase()}` };
    try {
      await this.db.send(new PutCommand({ TableName: this.table, Item: { ...key, kind: 'T', id }, ConditionExpression: 'attribute_not_exists(sk) OR id = :id', ExpressionAttributeValues: { ':id': id } }));
      return null;
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      const { Item } = await this.db.send(new GetCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
      return (Item?.id as string | undefined) ?? null;
    }
  }

  async releaseTxn(dept: string, txn: string, id: string) {
    try {
      await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: pk(dept), sk: `T#${txn.toUpperCase()}` }, ConditionExpression: 'id = :id', ExpressionAttributeValues: { ':id': id } }));
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  async purgeRegistration(registration: FestRegistration) {
    const { dept, id, phone } = registration;
    const [phoneOwner, submissionOwner] = await Promise.all([this.findPhone(dept, phone), registration.sid ? this.findSubmission(dept, registration.sid) : null]);
    const keys = [`R#${id}`];
    if (phoneOwner === id) keys.push(`P#${phone}`);
    if (registration.sid && submissionOwner === id) keys.push(`X#${registration.sid}`);
    await Promise.all(keys.map((sk) => this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: pk(dept), sk } }))));
    const txn = registration.entry.payment?.txn;
    if (txn) await this.releaseTxn(dept, txn, id);
  }

  async purgeResult(dept: string, eventId: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: pk(dept), sk: `E#${eventId}` } }));
  }

  async resetCounter(dept: string, source: FestSource) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: pk(dept), sk: `C#${source}` } }));
  }
}
