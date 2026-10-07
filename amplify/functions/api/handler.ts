/**
 * The registration API on AWS Lambda.
 *
 * Invoked two ways:
 *   - by API Gateway (HTTP API) for every /api/* request: see server/http.ts for the routes;
 *   - by an EventBridge schedule every 10 minutes: retries whatever failed earlier (the
 *     Google Drive / Sheets copy, or the pass and email of an approved registration).
 *
 * Secrets arrive in process.env (Amplify resolves them from SSM before this code runs).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, ScheduledEvent } from 'aws-lambda';
import { readConfig } from '../../../server/config';
import { DriveStore } from '../../../server/drive';
import { DynamoStore } from '../../../server/dynamoStore';
import { S3Files } from '../../../server/files';
import { sendMail } from '../../../server/gmail';
import { GoogleClient } from '../../../server/google';
import { route } from '../../../server/http';
import { passLogo } from '../../../server/passLogo';
import { Service } from '../../../server/service';
import { SheetsStore } from '../../../server/sheets';

/** One JSON line per event in CloudWatch Logs; never tokens, passwords or keys. */
const log = (message: string, details: Record<string, unknown> = {}) => console.log(JSON.stringify({ message, ...details }));

let service: Service | null | undefined;
/** Names (never values) of the settings that were missing, for /api/health to report. */
let missingSettings: string[] = [];

/** Built once per Lambda instance; null while required settings are missing. */
function getService(): Service | null {
  if (service !== undefined) return service;
  const { config, missing } = readConfig(process.env);
  if (!config) {
    missingSettings = [...missing];
    log('Registration API is not configured: set these Amplify secrets / variables', { missing });
    service = null;
    return service;
  }
  missingSettings = [];
  const google = new GoogleClient(config.google);
  service = new Service({
    store: new DynamoStore(config.tables),
    files: new S3Files(config.bucket),
    sheets: new SheetsStore(google, config.sheetId, config.sheetTab),
    drive: new DriveStore(google),
    sendMail: (mime) => sendMail(google, mime),
    logo: passLogo(),
    paymentFolderId: config.paymentFolderId,
    passFolderId: config.passFolderId,
    mail: config.mail,
    admin: config.admin,
    rateLimit: config.rateLimit,
    log,
  });
  return service;
}

const isHttp = (event: APIGatewayProxyEventV2 | ScheduledEvent): event is APIGatewayProxyEventV2 =>
  'requestContext' in event && 'http' in event.requestContext;

export const handler = async (
  event: APIGatewayProxyEventV2 | ScheduledEvent,
): Promise<APIGatewayProxyStructuredResultV2 | void> => {
  if (isHttp(event)) {
    // /api/health names the settings still missing, so the deployment can be checked from
    // outside without reading CloudWatch. Names only: never a secret's value.
    if (event.rawPath === '/api/health' && !getService()) {
      return {
        statusCode: 503,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ success: false, code: 'NOT_CONFIGURED', missing: missingSettings }),
      };
    }
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    const body = event.body == null ? null : event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const response = await route(
      { method: event.requestContext.http.method.toUpperCase(), path: event.rawPath, headers, body, ip: event.requestContext.http.sourceIp },
      getService(),
      log,
    );
    return { statusCode: response.status, headers: response.headers, body: response.body };
  }

  // The schedule: retry what failed earlier.
  await getService()?.runScheduled();
};
