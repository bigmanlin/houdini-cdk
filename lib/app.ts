import { App } from 'aws-cdk-lib';
import { DdbStack } from './ddb/ddb';
import { S3Stack } from './s3/s3';
import { SqsStack } from './sqs/sqs';
import { EventBridgeStack } from './eventbridge/eventbridge';
import { EcrStack } from './ecr/ecr';
import { EcsStack } from './ecs/ecs';
import { CronLambdaStack } from './lambda/cronLambda';
import { EodLambdaStack } from './lambda/eodLambda';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

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
  usersTable: ddb.usersTable,
  portfoliosTable: ddb.portfoliosTable,
  positionsTable: ddb.positionsTable,
  tradesTable: ddb.tradesTable,
  cronJobsTable: ddb.cronJobsTable,
  cronJobRunsTable: ddb.cronJobRunsTable,
  transactionsTable: ddb.transactionsTable,
  portfolioEodValueHistoryTable: ddb.portfolioEodValueHistoryTable,
  overviewEodValueHistoryTable: ddb.overviewEodValueHistoryTable,
});

new EodLambdaStack(app, 'EodLambdaStack', {
  env,
  internalApiUrl: `http://${ecs.loadBalancerDnsName}`,
});

new CronLambdaStack(app, 'CronLambdaStack', {
  env,
  cronJobQueue: sqs.cronJobQueue,
  internalApiUrl: `http://${ecs.loadBalancerDnsName}`,
});
