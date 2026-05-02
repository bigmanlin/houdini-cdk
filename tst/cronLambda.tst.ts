import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DdbStack } from '../lib/ddb/ddb';
import { S3Stack } from '../lib/s3/s3';
import { SqsStack } from '../lib/sqs/sqs';
import { CronLambdaStack } from '../lib/lambda/cronLambda';

describe('CronLambdaStack', () => {
  const app = new App();
  const ddb = new DdbStack(app, 'TestDdbStack');
  const s3 = new S3Stack(app, 'TestS3Stack');
  const sqs = new SqsStack(app, 'TestSqsStack');
  const stack = new CronLambdaStack(app, 'TestCronLambdaStack', {
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
  const template = Template.fromStack(stack);

  test('creates 1 Lambda function', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('function uses Node.js 20 runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
    });
  });

  test('function has 5 minute timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 300,
    });
  });

  test('function has all required environment variable keys', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          STRATEGIES_BUCKET: Match.anyValue(),
          USERS_TABLE: Match.anyValue(),
          PORTFOLIOS_TABLE: Match.anyValue(),
          POSITIONS_TABLE: Match.anyValue(),
          TRADES_TABLE: Match.anyValue(),
          CRON_JOBS_TABLE: Match.anyValue(),
          CRON_JOB_RUNS_TABLE: Match.anyValue(),
          TRANSACTIONS_TABLE: Match.anyValue(),
        }),
      },
    });
  });

  test('SQS event source mapping exists with batch size 1', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
    });
  });

  test('execution role has DynamoDB read/write permissions', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const policyJson = JSON.stringify(policies);
    expect(policyJson).toContain('dynamodb:PutItem');
    expect(policyJson).toContain('dynamodb:GetItem');
    expect(policyJson).toContain('dynamodb:UpdateItem');
    expect(policyJson).toContain('dynamodb:DeleteItem');
  });

  test('execution role has S3 read permission on strategies bucket', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const policyJson = JSON.stringify(policies);
    expect(policyJson).toContain('s3:GetObject*');
    expect(policyJson).toContain('s3:List*');
  });
});
