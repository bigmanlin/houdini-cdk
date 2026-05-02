import { App } from 'aws-cdk-lib';
import { DdbStack } from './ddb/ddb';
import { S3Stack } from './s3/s3';
import { SqsStack } from './sqs/sqs';
import { EventBridgeStack } from './eventbridge/eventbridge';
import { CronLambdaStack } from './lambda/cronLambda';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const ddb = new DdbStack(app, 'DdbStack', { env });
const s3 = new S3Stack(app, 'S3Stack', { env });
const sqs = new SqsStack(app, 'SqsStack', { env });

const eventbridge = new EventBridgeStack(app, 'EventBridgeStack', {
  env,
  cronJobQueue: sqs.cronJobQueue,
});

new CronLambdaStack(app, 'CronLambdaStack', {
  env,
  cronJobQueue: sqs.cronJobQueue,
  strategiesBucket: s3.strategiesBucket,
  usersTable: ddb.usersTable,
  portfoliosTable: ddb.portfoliosTable,
  positionsTable: ddb.positionsTable,
  tradesTable: ddb.tradesTable,
  cronJobsTable: ddb.cronJobsTable,
  cronJobRunsTable: ddb.cronJobRunsTable,
  transactionsTable: ddb.transactionsTable,
});
