import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SqsStack } from '../lib/sqs/sqs';
import { CronLambdaStack } from '../lib/lambda/cronLambda';

describe('CronLambdaStack', () => {
  const app = new App();
  const sqs = new SqsStack(app, 'TestSqsStack');
  const stack = new CronLambdaStack(app, 'TestCronLambdaStack', {
    cronJobQueue: sqs.cronJobQueue,
    internalApiUrl: 'http://test-alb.us-east-1.elb.amazonaws.com',
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

  test('function has 30 second timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 30,
    });
  });

  test('function has INTERNAL_API_URL environment variable', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          INTERNAL_API_URL: 'http://test-alb.us-east-1.elb.amazonaws.com',
        }),
      },
    });
  });

  test('SQS event source mapping exists with batch size 1', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
    });
  });

  test('execution role has only basic Lambda execution policy', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({ 'Fn::Join': Match.anyValue() }),
      ]),
    });
    // No DynamoDB or S3 policies — logic runs in ECS, not Lambda
    const policies = template.findResources('AWS::IAM::Policy');
    const policyJson = JSON.stringify(policies);
    expect(policyJson).not.toContain('dynamodb:PutItem');
    expect(policyJson).not.toContain('s3:GetObject');
  });
});
