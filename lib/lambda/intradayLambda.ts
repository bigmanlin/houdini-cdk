import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code, IFunction } from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';

interface IntradayLambdaStackProps extends StackProps {
  internalApiUrl: string;
}

export class IntradayLambdaStack extends Stack {
  public readonly intradayFunction: IFunction;

  constructor(scope: Construct, id: string, props: IntradayLambdaStackProps) {
    super(scope, id, props);

    const executionRole = new Role(this, 'IntradayExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.intradayFunction = new Function(this, 'IntradayFunction', {
      functionName: 'houdini-intraday',
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 512,
      role: executionRole,
      environment: {
        INTERNAL_API_URL: props.internalApiUrl,
      },
      code: Code.fromInline(`
        exports.handler = async () => {
          const res = await fetch(process.env.INTERNAL_API_URL + '/internal/intraday/execute', { method: 'POST' });
          if (!res.ok) {
            const body = await res.text();
            throw new Error('Intraday execute failed: ' + res.status + ' ' + body);
          }
        };
      `),
    });

    const schedulerRole = new Role(this, 'IntradaySchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke the intraday Lambda',
    });

    schedulerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [this.intradayFunction.functionArn],
      }),
    );

    this.intradayFunction.addPermission('EventBridgeInvoke', {
      principal: new ServicePrincipal('scheduler.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceAccount: this.account,
    });

    // Fires every 30 minutes from 9:00 to 16:30 ET on weekdays; the handler's
    // session gate decides which fires actually record (skips pre-open 9:00,
    // post-close 16:30, holidays, and half-day afternoons). Timezone-aware
    // cron, so DST never shifts it.
    new CfnSchedule(this, 'IntradaySchedule', {
      name: 'houdini-intraday',
      scheduleExpression: 'cron(0/30 9-16 ? * MON-FRI *)',
      scheduleExpressionTimezone: 'America/New_York',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: this.intradayFunction.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });
  }
}
