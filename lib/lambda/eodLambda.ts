import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code, IFunction } from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';

interface EodLambdaStackProps extends StackProps {
  internalApiUrl: string;
}

export class EodLambdaStack extends Stack {
  public readonly eodFunction: IFunction;

  constructor(scope: Construct, id: string, props: EodLambdaStackProps) {
    super(scope, id, props);

    const executionRole = new Role(this, 'EodExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.eodFunction = new Function(this, 'EodFunction', {
      functionName: 'houdini-eod',
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
          const res = await fetch(process.env.INTERNAL_API_URL + '/internal/eod/execute', { method: 'POST' });
          if (!res.ok) {
            const body = await res.text();
            throw new Error('EOD execute failed: ' + res.status + ' ' + body);
          }
        };
      `),
    });

    const schedulerRole = new Role(this, 'EodSchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke the EOD Lambda',
    });

    schedulerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [this.eodFunction.functionArn],
      }),
    );

    this.eodFunction.addPermission('EventBridgeInvoke', {
      principal: new ServicePrincipal('scheduler.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceAccount: this.account,
    });

    // Fires at 4:30 PM ET on weekdays — 30 minutes after market close
    new CfnSchedule(this, 'EodSchedule', {
      name: 'houdini-eod',
      scheduleExpression: 'cron(30 16 ? * MON-FRI *)',
      scheduleExpressionTimezone: 'America/New_York',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: this.eodFunction.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });
  }
}
