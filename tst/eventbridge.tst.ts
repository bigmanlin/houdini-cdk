import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SqsStack } from '../lib/sqs/sqs';
import { EventBridgeStack } from '../lib/eventbridge/eventbridge';

describe('EventBridgeStack', () => {
  const env = { account: '123456789012', region: 'us-east-1' };
  const app = new App();
  const sqs = new SqsStack(app, 'TestSqsStack', { env });
  const stack = new EventBridgeStack(app, 'TestEventBridgeStack', {
    env,
    cronJobQueue: sqs.cronJobQueue,
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
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'sqs:SendMessage',
          }),
        ]),
      },
    });
  });
});
