import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EodLambdaStack } from '../lib/lambda/eodLambda';

describe('EodLambdaStack', () => {
  const env = { account: '123456789012', region: 'us-east-1' };
  const app = new App();
  const stack = new EodLambdaStack(app, 'TestEodLambdaStack', {
    env,
    internalApiUrl: 'http://test-alb.us-east-1.elb.amazonaws.com',
  });
  const template = Template.fromStack(stack);

  test('creates 1 Lambda function', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('function uses Node.js 22 runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
    });
  });

  test('function has 15 minute timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 900,
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

  test('creates EOD schedule firing at 4:30 PM ET on weekdays', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'houdini-eod',
      ScheduleExpression: 'cron(30 16 ? * MON-FRI *)',
      ScheduleExpressionTimezone: 'America/New_York',
    });
  });

  test('execution role has only basic Lambda execution policy — no DDB or Alpaca', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const policyJson = JSON.stringify(policies);
    expect(policyJson).not.toContain('dynamodb:PutItem');
    expect(policyJson).not.toContain('secretsmanager:GetSecretValue');
  });
});
