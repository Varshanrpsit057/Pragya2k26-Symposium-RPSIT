/**
 * The PRAGYA 2026 backend on AWS (Amplify Gen 2), deployed by Amplify Hosting with each push:
 *
 *   HTTP API (API Gateway)  /api/*  →  Lambda "pragya-api"  →  DynamoDB, S3, Google APIs
 *   EventBridge schedule (every 10 min)  →  the same Lambda: backups (bucket + Google Sheet), retries
 *   DynamoDB "Registrations" + "Control"  the approval workflow (authoritative state)
 *   S3 (private)            payment screenshots and participant passes
 *
 * Abuse protection, from the edge in: every route has its own throttle at the gateway (all
 * visitors together), the function limits each network address (server/service.ts), and an
 * optional cap on concurrent function runs bounds the bill (API_RESERVED_CONCURRENCY).
 * Gateway access logs and function logs are kept for three months.
 *
 * The API URL is written to amplify_outputs.json, which the website build reads.
 */
import { defineBackend } from '@aws-amplify/backend';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnStage, CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AttributeType, BillingMode, ProjectionType, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import type { CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { api } from './functions/api/resource';

const backend = defineBackend({ api });
const lambda = backend.api.resources.lambda;
// Everything lives next to the function, so nothing depends on another stack.
const stack = Stack.of(lambda);

/**
 * Websites allowed to call the API and upload to S3: this branch's Amplify address, plus
 * ALLOWED_ORIGINS (comma separated, e.g. a custom domain). A sandbox allows the Vite dev server.
 */
const branch = process.env.AWS_BRANCH;
const appId = process.env.AWS_APP_ID;
const origins = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);
if (branch && appId) origins.add(`https://${branch.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.${appId}.amplifyapp.com`);
if (!branch) for (const port of [5173, 4173]) origins.add(`http://localhost:${port}`);
const allowedOrigins = [...origins];

// --- DynamoDB: the workflow state ------------------------------------------------------
// Kept if the stack is ever deleted (registrations are irreplaceable), with point-in-time
// recovery, and protected from being deleted by hand. Encrypted at rest with DynamoDB's own
// key (AES-256, free): an AWS managed key would call AWS KMS for this account all day long,
// past its free requests.
const registrations = new Table(stack, 'Registrations', {
  partitionKey: { name: 'registrationId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.DEFAULT,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  deletionProtection: true,
  removalPolicy: RemovalPolicy.RETAIN,
});
registrations.addGlobalSecondaryIndex({
  indexName: 'byStatus',
  partitionKey: { name: 'status', type: AttributeType.STRING },
  sortKey: { name: 'submittedAt', type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
});

// Claims (one email / transaction ID / form per registration), the ID counter, admin
// sessions and rate limits (both expire on their own).
const control = new Table(stack, 'Control', {
  partitionKey: { name: 'pk', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.DEFAULT,
  timeToLiveAttribute: 'expiresAtEpoch',
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  deletionProtection: true,
  removalPolicy: RemovalPolicy.RETAIN,
});

// The college-wide fest: registrations and results per department (pk D#<dept>, sk R#<id> /
// E#<event> / claims / counters), and the "byDept" index (dept, u): what changed since a moment.
const fest = new Table(stack, 'FestRecords', {
  partitionKey: { name: 'pk', type: AttributeType.STRING },
  sortKey: { name: 'sk', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.DEFAULT,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  deletionProtection: true,
  removalPolicy: RemovalPolicy.RETAIN,
});
fest.addGlobalSecondaryIndex({
  indexName: 'byDept',
  partitionKey: { name: 'dept', type: AttributeType.STRING },
  sortKey: { name: 'u', type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
});

// --- S3: private files -------------------------------------------------------------------
const files = new Bucket(stack, 'PrivateFiles', {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  // Every earlier version of a file is kept: an overwritten or deleted screenshot or pass can be restored.
  versioned: true,
  removalPolicy: RemovalPolicy.RETAIN,
  // The browser uploads the payment screenshot with a presigned POST.
  cors: [{ allowedOrigins, allowedMethods: [HttpMethods.POST], allowedHeaders: ['*'], maxAge: 3000 }],
  // Screenshots uploaded but never registered are removed after a day.
  lifecycleRules: [
    { prefix: 'uploads/', expiration: Duration.days(1), noncurrentVersionExpiration: Duration.days(1), abortIncompleteMultipartUploadAfter: Duration.days(1) },
  ],
});

registrations.grantReadWriteData(lambda);
control.grantReadWriteData(lambda);
fest.grantReadWriteData(lambda);
files.grantReadWrite(lambda);
backend.api.addEnvironment('REGISTRATIONS_TABLE', registrations.tableName);
backend.api.addEnvironment('CONTROL_TABLE', control.tableName);
backend.api.addEnvironment('FEST_TABLE', fest.tableName);
backend.api.addEnvironment('FILES_BUCKET', files.bucketName);

// An optional ceiling on simultaneous runs (e.g. 50), so a flood can never run up the bill or
// exhaust the Google API quotas. Left unset by default: a new AWS account may not have the
// spare concurrency that reserving some requires.
const reserved = Number(process.env.API_RESERVED_CONCURRENCY);
if (Number.isInteger(reserved) && reserved > 0) {
  (lambda.node.defaultChild as CfnFunction).reservedConcurrentExecutions = reserved;
}

// --- HTTP API -------------------------------------------------------------------------------
const httpApi = new HttpApi(stack, 'HttpApi', {
  apiName: `pragya-api-${branch ?? 'sandbox'}`,
  corsPreflight: {
    allowOrigins: allowedOrigins,
    allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
    allowHeaders: ['content-type', 'authorization'],
    maxAge: Duration.days(1),
  },
  createDefaultStage: true,
});
const integration = new HttpLambdaIntegration('ApiIntegration', lambda);

/**
 * One route per endpoint (server/http.ts), each with its own throttle: steady requests per
 * second for all visitors together, plus a short burst. Well above a registration rush, far
 * below anything abusive. Paths not listed get a 404 from the gateway without running the
 * function. Each network address is also limited by the function itself.
 */
const ROUTES: { method: HttpMethod; path: string; rate: number; burst: number }[] = [
  { method: HttpMethod.GET, path: '/api/health', rate: 5, burst: 10 },
  // The schedule the website follows (a test timeline can change it): once per page load.
  { method: HttpMethod.GET, path: '/api/schedule', rate: 50, burst: 100 },
  { method: HttpMethod.POST, path: '/api/uploads', rate: 50, burst: 100 },
  { method: HttpMethod.POST, path: '/api/register', rate: 50, burst: 100 },
  { method: HttpMethod.POST, path: '/api/status', rate: 25, burst: 50 },
  { method: HttpMethod.POST, path: '/api/pass', rate: 10, burst: 20 },
  // The event-day student page: sign-in (and the check every 30 s while a payment waits for
  // the desk), the pass, and GPay screenshots. Sized for 30+ students at the same moment.
  { method: HttpMethod.GET, path: '/api/student/portal', rate: 20, burst: 60 },
  { method: HttpMethod.POST, path: '/api/student', rate: 30, burst: 90 },
  { method: HttpMethod.POST, path: '/api/student/pass', rate: 15, burst: 45 },
  { method: HttpMethod.POST, path: '/api/student/upload', rate: 15, burst: 45 },
  { method: HttpMethod.POST, path: '/api/student/proof', rate: 15, burst: 45 },
  // The fest's students registering on their own phones (no sign-in): the page's details, the
  // registration (a morning rush of hundreds), and their own page (status, events, transaction ID).
  { method: HttpMethod.GET, path: '/api/fest/info', rate: 60, burst: 200 },
  { method: HttpMethod.POST, path: '/api/fest/register', rate: 40, burst: 120 },
  { method: HttpMethod.POST, path: '/api/fest/me', rate: 40, burst: 120 },
  // "My registration ID" by mobile number and email, and the payment step's QR code.
  { method: HttpMethod.POST, path: '/api/fest/find', rate: 20, burst: 60 },
  { method: HttpMethod.GET, path: '/api/fest/payment', rate: 40, burst: 120 },
  { method: HttpMethod.POST, path: '/api/fest/me/events', rate: 20, burst: 60 },
  { method: HttpMethod.POST, path: '/api/fest/me/payment', rate: 10, burst: 30 },
  // Contact admin (works signed out too) and a staff member's own requests with the answers.
  { method: HttpMethod.POST, path: '/api/help', rate: 5, burst: 15 },
  { method: HttpMethod.GET, path: '/api/help/mine', rate: 10, burst: 30 },
  // Staff sign in now and then: a trickle is plenty, and it starves password guessing.
  { method: HttpMethod.POST, path: '/api/admin/login', rate: 10, burst: 60 },
  // On the event day about 20 staff devices refresh their lists every 15 seconds and record
  // fees and attendance: a few requests a second, with room for everyone clicking at once.
  // On the fest day about 300 staff phones ask for changes every 15 seconds (a POST) and
  // register, take fees and mark attendance: room for all of them coming back at once.
  { method: HttpMethod.GET, path: '/api/admin/{proxy+}', rate: 60, burst: 150 },
  { method: HttpMethod.POST, path: '/api/admin/{proxy+}', rate: 120, burst: 300 },
];
const routes = ROUTES.flatMap(({ method, path }) => httpApi.addRoutes({ path, methods: [method], integration }));

const stage = httpApi.defaultStage!.node.defaultChild as CfnStage;
// The ceiling for the whole API, then each route's own (keys as API Gateway names routes).
stage.defaultRouteSettings = { throttlingBurstLimit: 500, throttlingRateLimit: 250 };
stage.routeSettings = Object.fromEntries(
  ROUTES.map(({ method, path, rate, burst }) => [`${method} ${path}`, { ThrottlingRateLimit: rate, ThrottlingBurstLimit: burst }]),
);
// Route settings may only name routes that already exist.
stage.node.addDependency(...routes);

// One line per request (who, which route, the answer, how long it took), for spotting abuse.
const accessLogs = new LogGroup(stack, 'ApiAccessLogs', {
  retention: RetentionDays.THREE_MONTHS,
  removalPolicy: RemovalPolicy.DESTROY,
});
stage.accessLogSettings = {
  destinationArn: accessLogs.logGroupArn,
  format: JSON.stringify({
    requestId: '$context.requestId',
    time: '$context.requestTime',
    ip: '$context.identity.sourceIp',
    route: '$context.routeKey',
    status: '$context.status',
    latencyMs: '$context.responseLatency',
    integrationError: '$context.integrationErrorMessage',
  }),
};

backend.addOutput({ custom: { apiUrl: httpApi.apiEndpoint, allowedOrigins } });
