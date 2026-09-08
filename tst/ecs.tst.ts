import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DdbStack } from '../lib/ddb/ddb';
import { S3Stack } from '../lib/s3/s3';
import { EcrStack } from '../lib/ecr/ecr';
import { SqsStack } from '../lib/sqs/sqs';
import { EcsStack } from '../lib/ecs/ecs';

describe('EcsStack', () => {
  const env = { account: '123456789012', region: 'us-east-1' };
  const app = new App();
  const ddb = new DdbStack(app, 'TestDdbStack', { env });
  const s3 = new S3Stack(app, 'TestS3Stack', { env });
  const ecr = new EcrStack(app, 'TestEcrStack', { env });
  const sqs = new SqsStack(app, 'TestSqsStack', { env });
  const stack = new EcsStack(app, 'TestEcsStack', {
    env,
    repository: ecr.repository,
    strategiesBucket: s3.strategiesBucket,
    uploadsBucket: s3.uploadsBucket,
    usersTable: ddb.usersTable,
    identitiesTable: ddb.identitiesTable,
    portfoliosTable: ddb.portfoliosTable,
    positionsTable: ddb.positionsTable,
    bookPositionsTable: ddb.bookPositionsTable,
    tradesTable: ddb.tradesTable,
    cronJobsTable: ddb.cronJobsTable,
    cronJobRunsTable: ddb.cronJobRunsTable,
    agentsTable: ddb.agentsTable,
    activityTable: ddb.activityTable,
    portfolioEodValueHistoryTable: ddb.portfolioEodValueHistoryTable,
    overviewEodValueHistoryTable: ddb.overviewEodValueHistoryTable,
    portfolioIntradayValueHistoryTable: ddb.portfolioIntradayValueHistoryTable,
    overviewIntradayValueHistoryTable: ddb.overviewIntradayValueHistoryTable,
    stockResearchTable: ddb.stockResearchTable,
    briefingsTable: ddb.briefingsTable,
    brokerConnectionsTable: ddb.brokerConnectionsTable,
    deviceTokensTable: ddb.deviceTokensTable,
    workerQueue: sqs.workerQueue,
  });
  const template = Template.fromStack(stack);

  test('both tasks know the worker queue, and the one role may send to it and consume it', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            Match.objectLike({ Name: 'WORKER_QUEUE_URL' }),
          ]),
        }),
      ]),
    });
    // The role's grants overflow one inline policy into managed ones.
    const policies = JSON.stringify({
      ...template.findResources('AWS::IAM::Policy'),
      ...template.findResources('AWS::IAM::ManagedPolicy'),
    });
    expect(policies).toContain('sqs:SendMessage');
    expect(policies).toContain('sqs:ReceiveMessage');
    expect(policies).toContain('sqs:DeleteMessage');
  });

  test('runs the API behind the load balancer and the worker beside it', () => {
    template.resourceCountIs('AWS::ECS::Service', 2);
    template.hasResourceProperties('AWS::ECS::Service', { ServiceName: 'HoudiniService' });
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'HoudiniWorker',
      LoadBalancers: Match.absent(),
    });
  });

  test('the API task definition targets port 3000', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          PortMappings: [{ ContainerPort: 3000, Protocol: 'tcp' }],
        }),
      ]),
    });
  });

  test('the worker runs the worker entry point from the same image and env', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'houdini-worker',
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Command: ['node', 'dist/worker.js'],
          Environment: Match.arrayWith([Match.objectLike({ Name: 'STRATEGIES_BUCKET' })]),
          Secrets: Match.arrayWith([Match.objectLike({ Name: 'ANTHROPIC_API_KEY' })]),
        }),
      ]),
    });
  });

  test('the worker runs as exactly one task around the clock', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'HoudiniWorker',
      DesiredCount: 1,
    });
    const targets = template.findResources('AWS::ApplicationAutoScaling::ScalableTarget');
    const workerTargets = Object.values(targets).filter((target) =>
      JSON.stringify(target).includes('HoudiniWorker'),
    );
    expect(workerTargets).toHaveLength(0);
  });

  test('no task carries queue or scheduler settings any more', () => {
    const definitions = template.findResources('AWS::ECS::TaskDefinition');
    expect(JSON.stringify(definitions)).not.toContain('CRON_JOB_QUEUE_ARN');
    expect(JSON.stringify(definitions)).not.toContain('SCHEDULER_ROLE_ARN');
    template.resourceCountIs('AWS::Scheduler::Schedule', 0);
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
    const policies = {
      ...template.findResources('AWS::IAM::Policy'),
      ...template.findResources('AWS::IAM::ManagedPolicy'),
    };
    const policyJson = JSON.stringify(policies);
    expect(policyJson).toContain('dynamodb:PutItem');
    expect(policyJson).toContain('dynamodb:GetItem');
    expect(policyJson).toContain('dynamodb:UpdateItem');
    expect(policyJson).not.toContain('scheduler:CreateSchedule');
    expect(policyJson).not.toContain('CronJobQueue');
  });

  test('task role has S3 read/write permission on strategies bucket', () => {
    const policies = {
      ...template.findResources('AWS::IAM::Policy'),
      ...template.findResources('AWS::IAM::ManagedPolicy'),
    };
    const policyJson = JSON.stringify(policies);
    expect(policyJson).toContain('s3:PutObject');
    expect(policyJson).toContain('s3:GetObject*');
  });

  test('ALB is internet-facing', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
    });
  });
});
