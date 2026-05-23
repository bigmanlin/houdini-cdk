import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DdbStack } from '../lib/ddb/ddb';
import { SqsStack } from '../lib/sqs/sqs';
import { EodLambdaStack } from '../lib/lambda/eodLambda';
import { EventBridgeStack } from '../lib/eventbridge/eventbridge';

describe('EventBridgeStack', () => {
  const env = { account: '123456789012', region: 'us-east-1' };
  const app = new App();
  const ddb = new DdbStack(app, 'TestDdbStack', { env });
  const sqsStack = new SqsStack(app, 'TestSqsStack', { env });
  const eod = new EodLambdaStack(app, 'TestEodLambdaStack', {
    env,
    portfoliosTable: ddb.portfoliosTable,
    positionsTable: ddb.positionsTable,
    portfolioEodValueHistoryTable: ddb.portfolioEodValueHistoryTable,
    overviewEodValueHistoryTable: ddb.overviewEodValueHistoryTable,
  });
  const stack = new EventBridgeStack(app, 'TestEventBridgeStack', {
    env,
    cronJobQueue: sqsStack.cronJobQueue,
    eodFunction: eod.eodFunction,
  });
  const template = Template.fromStack(stack);

  test('creates schedule group named houdini-cron-jobs', () => {
    template.hasResourceProperties('AWS::Scheduler::ScheduleGroup', {
      Name: 'houdini-cron-jobs',
    });
  });

  test('scheduler role trusts scheduler.amazonaws.com', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Principal: { Service: 'scheduler.amazonaws.com' },
            Action: 'sts:AssumeRole',
          },
        ],
      },
    });
  });

  test('scheduler role can send messages to SQS', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sqs:SendMessage',
          },
        ],
      },
    });
  });
});
