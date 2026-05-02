import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SqsStack } from '../lib/sqs/sqs';
import { EventBridgeStack } from '../lib/eventbridge/eventbridge';

describe('EventBridgeStack', () => {
  const app = new App();
  const sqsStack = new SqsStack(app, 'TestSqsStack');
  const stack = new EventBridgeStack(app, 'TestEventBridgeStack', {
    cronJobQueue: sqsStack.cronJobQueue,
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
