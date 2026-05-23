import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DdbStack } from '../lib/ddb/ddb';
import { S3Stack } from '../lib/s3/s3';
import { SqsStack } from '../lib/sqs/sqs';
import { EventBridgeStack } from '../lib/eventbridge/eventbridge';
import { EcrStack } from '../lib/ecr/ecr';
import { EcsStack } from '../lib/ecs/ecs';
import { EodLambdaStack } from '../lib/lambda/eodLambda';

describe('EcsStack', () => {
  const env = { account: '123456789012', region: 'us-east-1' };
  const app = new App();
  const ddb = new DdbStack(app, 'TestDdbStack', { env });
  const s3 = new S3Stack(app, 'TestS3Stack', { env });
  const sqs = new SqsStack(app, 'TestSqsStack', { env });
  const eod = new EodLambdaStack(app, 'TestEodLambdaStack', {
    env,
    portfoliosTable: ddb.portfoliosTable,
    positionsTable: ddb.positionsTable,
    portfolioEodValueHistoryTable: ddb.portfolioEodValueHistoryTable,
    overviewEodValueHistoryTable: ddb.overviewEodValueHistoryTable,
  });
  const eventbridge = new EventBridgeStack(app, 'TestEventBridgeStack', {
    env,
    cronJobQueue: sqs.cronJobQueue,
    eodFunction: eod.eodFunction,
  });
  const ecr = new EcrStack(app, 'TestEcrStack', { env });
  const stack = new EcsStack(app, 'TestEcsStack', {
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
  });
  const template = Template.fromStack(stack);

  test('creates a Fargate service', () => {
    template.resourceCountIs('AWS::ECS::Service', 1);
  });

  test('task definition targets port 3000', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          PortMappings: [{ ContainerPort: 3000, Protocol: 'tcp' }],
        }),
      ]),
    });
  });

  test('task definition has plaintext environment variables', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            Match.objectLike({ Name: 'ANTHROPIC_MODEL', Value: 'claude-sonnet-4-6' }),
            Match.objectLike({ Name: 'STRATEGIES_BUCKET' }),
            Match.objectLike({ Name: 'CRON_JOB_QUEUE_ARN' }),
            Match.objectLike({ Name: 'SCHEDULER_ROLE_ARN' }),
          ]),
        }),
      ]),
    });
  });

  test('task definition injects secrets from Secrets Manager', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'ALPACA_API_KEY' }),
            Match.objectLike({ Name: 'ALPACA_API_SECRET' }),
            Match.objectLike({ Name: 'FMP_API_KEY' }),
            Match.objectLike({ Name: 'ANTHROPIC_API_KEY' }),
          ]),
        }),
      ]),
    });
  });

  test('task role has DynamoDB read/write permissions', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const policyJson = JSON.stringify(policies);
    expect(policyJson).toContain('dynamodb:PutItem');
    expect(policyJson).toContain('dynamodb:GetItem');
    expect(policyJson).toContain('dynamodb:UpdateItem');
  });

  test('task role has S3 read/write permission on strategies bucket', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const policyJson = JSON.stringify(policies);
    expect(policyJson).toContain('s3:PutObject');
    expect(policyJson).toContain('s3:GetObject*');
  });

  test('task role can create EventBridge schedules', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const policyJson = JSON.stringify(policies);
    expect(policyJson).toContain('scheduler:CreateSchedule');
    expect(policyJson).toContain('iam:PassRole');
  });

  test('ALB is internet-facing', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
    });
  });
});
