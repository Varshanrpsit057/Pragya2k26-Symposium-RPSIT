/**
 * The PRAGYA 2026 backend on AWS (Amplify Gen 2), deployed by Amplify Hosting with each push:
 *
 *   HTTP API (API Gateway)  /api/*  →  Lambda "pragya-api"  →  DynamoDB, S3, Google APIs
 *   EventBridge schedule (every 10 min)  →  the same Lambda: retries
 *   DynamoDB "Registrations" + "Control"  the approval workflow (authoritative state)
 *   S3 (private)            payment screenshots and participant passes
 *
 * The API URL is written to amplify_outputs.json, which the website build reads.
 */
import { defineBackend } from '@aws-amplify/backend';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnStage, CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AttributeType, BillingMode, ProjectionType, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
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
// Kept if the stack is ever deleted (registrations are irreplaceable), with point-in-time recovery.
const registrations = new Table(stack, 'Registrations', {
  partitionKey: { name: 'registrationId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  encryption: TableEncryption.AWS_MANAGED,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
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
  encryption: TableEncryption.AWS_MANAGED,
  timeToLiveAttribute: 'expiresAtEpoch',
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
  removalPolicy: RemovalPolicy.RETAIN,
});

// --- S3: private files -------------------------------------------------------------------
const files = new Bucket(stack, 'PrivateFiles', {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  removalPolicy: RemovalPolicy.RETAIN,
  // The browser uploads the payment screenshot with a presigned POST.
  cors: [{ allowedOrigins, allowedMethods: [HttpMethods.POST], allowedHeaders: ['*'], maxAge: 3000 }],
  // Screenshots uploaded but never registered are removed after a day.
  lifecycleRules: [{ prefix: 'uploads/', expiration: Duration.days(1), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
});

registrations.grantReadWriteData(lambda);
control.grantReadWriteData(lambda);
files.grantReadWrite(lambda);
backend.api.addEnvironment('REGISTRATIONS_TABLE', registrations.tableName);
backend.api.addEnvironment('CONTROL_TABLE', control.tableName);
backend.api.addEnvironment('FILES_BUCKET', files.bucketName);

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
httpApi.addRoutes({
  path: '/api/{proxy+}',
  methods: [HttpMethod.GET, HttpMethod.POST],
  integration: new HttpLambdaIntegration('ApiIntegration', lambda),
});
// A ceiling for the whole API, well above a registration rush, far below anything abusive.
const stage = httpApi.defaultStage!.node.defaultChild as CfnStage;
stage.defaultRouteSettings = { throttlingBurstLimit: 200, throttlingRateLimit: 100 };

backend.addOutput({ custom: { apiUrl: httpApi.apiEndpoint, allowedOrigins } });
