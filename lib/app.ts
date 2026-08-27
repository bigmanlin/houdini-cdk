import { App } from 'aws-cdk-lib';
import { DdbStack } from './ddb/ddb';
import { S3Stack } from './s3/s3';
import { SqsStack } from './sqs/sqs';
import { EventBridgeStack } from './eventbridge/eventbridge';
import { EcrStack } from './ecr/ecr';
import { EcsStack } from './ecs/ecs';
import { WafStack } from './waf/waf';
import { SiteStack } from './site/site';
import { EodLambdaStack } from './lambda/eodLambda';
import { IntradayLambdaStack } from './lambda/intradayLambda';
import { StockResearchLambdaStack } from './lambda/stockResearchLambda';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// us-east-1: CloudFront only accepts certificates issued there, whatever region
// the rest of the stack lives in.
new SiteStack(app, 'SiteStack', {
  env: { account: env.account, region: 'us-east-1' },
});

const ddb = new DdbStack(app, 'DdbStack', { env });
const s3 = new S3Stack(app, 'S3Stack', { env });
const sqs = new SqsStack(app, 'SqsStack', { env });
const ecr = new EcrStack(app, 'EcrStack', { env });

const eventbridge = new EventBridgeStack(app, 'EventBridgeStack', {
  env,
  cronJobQueue: sqs.cronJobQueue,
});

const ecs = new EcsStack(app, 'EcsStack', {
  env,
  repository: ecr.repository,
  cronJobQueue: sqs.cronJobQueue,
  schedulerRoleArn: eventbridge.schedulerRole.roleArn,
  strategiesBucket: s3.strategiesBucket,
  uploadsBucket: s3.uploadsBucket,
  usersTable: ddb.usersTable,
  identitiesTable: ddb.identitiesTable,
  portfoliosTable: ddb.portfoliosTable,
  positionsTable: ddb.positionsTable,
  tradesTable: ddb.tradesTable,
  cronJobsTable: ddb.cronJobsTable,
  cronJobRunsTable: ddb.cronJobRunsTable,
  portfolioEodValueHistoryTable: ddb.portfolioEodValueHistoryTable,
  overviewEodValueHistoryTable: ddb.overviewEodValueHistoryTable,
  portfolioIntradayValueHistoryTable: ddb.portfolioIntradayValueHistoryTable,
  overviewIntradayValueHistoryTable: ddb.overviewIntradayValueHistoryTable,
  stockResearchTable: ddb.stockResearchTable,
  briefingsTable: ddb.briefingsTable,
  brokerConnectionsTable: ddb.brokerConnectionsTable,
});

new EodLambdaStack(app, 'EodLambdaStack', {
  env,
  internalApiUrl: ecs.apiUrl,
});

new IntradayLambdaStack(app, 'IntradayLambdaStack', {
  env,
  internalApiUrl: ecs.apiUrl,
});

new StockResearchLambdaStack(app, 'StockResearchLambdaStack', {
  env,
  internalApiUrl: ecs.apiUrl,
});

new WafStack(app, 'WafStack', {
  env,
  loadBalancerArn: ecs.loadBalancerArn,
});
