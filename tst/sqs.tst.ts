import { App, Duration } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SqsStack } from '../lib/sqs/sqs';

describe('SqsStack', () => {
  const app = new App();
  const stack = new SqsStack(app, 'TestSqsStack');
  const template = Template.fromStack(stack);

  test('creates 2 queues', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  test('main queue has correct visibility timeout', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'houdini-cron-job-queue',
      VisibilityTimeout: Duration.seconds(300 * 4).toSeconds(),
    });
  });

  test('main queue has DLQ with maxReceiveCount of 3', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'houdini-cron-job-queue',
      RedrivePolicy: {
        maxReceiveCount: 3,
      },
    });
  });

  test('DLQ exists', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'houdini-cron-job-dlq',
    });
  });
});
