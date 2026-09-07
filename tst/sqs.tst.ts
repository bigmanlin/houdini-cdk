import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SqsStack } from '../lib/sqs/sqs';

describe('SqsStack', () => {
  const app = new App();
  const stack = new SqsStack(app, 'TestSqsStack');
  const template = Template.fromStack(stack);

  test('creates the one queue the worker listens on', () => {
    template.resourceCountIs('AWS::SQS::Queue', 1);
  });

  test('the worker queue long polls and needs no dead letter queue', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'atrius-worker-queue',
      ReceiveMessageWaitTimeSeconds: 20,
      RedrivePolicy: Match.absent(),
    });
  });
});
