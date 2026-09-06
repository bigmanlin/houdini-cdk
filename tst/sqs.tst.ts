import { App, Duration } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SqsStack } from '../lib/sqs/sqs';

describe('SqsStack', () => {
  const app = new App();
  const stack = new SqsStack(app, 'TestSqsStack');
  const template = Template.fromStack(stack);

  test('creates 3 queues', () => {
    template.resourceCountIs('AWS::SQS::Queue', 3);
  });

  test('the worker queue long polls and needs no dead letter queue', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'atrius-worker-queue',
      ReceiveMessageWaitTimeSeconds: 20,
      RedrivePolicy: Match.absent(),
    });
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
