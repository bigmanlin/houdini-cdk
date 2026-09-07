import { App } from 'aws-cdk-lib';
import { DdbStack } from './ddb/ddb';
import { S3Stack } from './s3/s3';
import { SqsStack } from './sqs/sqs';
import { EcrStack } from './ecr/ecr';
import { EcsStack } from './ecs/ecs';
import { WafStack } from './waf/waf';
import { SiteStack } from './site/site';

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

const ecs = new EcsStack(app, 'EcsStack', {
  env,
  repository: ecr.repository,
  strategiesBucket: s3.strategiesBucket,
  uploadsBucket: s3.uploadsBucket,
  usersTable: ddb.usersTable,
  identitiesTable: ddb.identitiesTable,
  portfoliosTable: ddb.portfoliosTable,
  positionsTable: ddb.positionsTable,
  agentsTable: ddb.agentsTable,
  activityTable: ddb.activityTable,
  portfolioEodValueHistoryTable: ddb.portfolioEodValueHistoryTable,
  overviewEodValueHistoryTable: ddb.overviewEodValueHistoryTable,
  portfolioIntradayValueHistoryTable: ddb.portfolioIntradayValueHistoryTable,
  overviewIntradayValueHistoryTable: ddb.overviewIntradayValueHistoryTable,
  brokerConnectionsTable: ddb.brokerConnectionsTable,
  deviceTokensTable: ddb.deviceTokensTable,
  workerQueue: sqs.workerQueue,
});

new WafStack(app, 'WafStack', {
  env,
  loadBalancerArn: ecs.loadBalancerArn,
});
