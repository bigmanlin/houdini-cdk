import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code, IFunction } from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';

interface StockResearchLambdaStackProps extends StackProps {
  internalApiUrl: string;
}

export class StockResearchLambdaStack extends Stack {
  public readonly stockResearchFunction: IFunction;

  constructor(scope: Construct, id: string, props: StockResearchLambdaStackProps) {
    super(scope, id, props);

    const executionRole = new Role(this, 'StockResearchExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // The ECS route responds 200 immediately and runs the ingestion detached,
    // so a short timeout is enough — retries at this layer are not meaningful.
    this.stockResearchFunction = new Function(this, 'StockResearchFunction', {
      functionName: 'houdini-stock-research-trigger',
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.minutes(3),
      memorySize: 256,
      role: executionRole,
      environment: {
        INTERNAL_API_URL: props.internalApiUrl,
      },
      code: Code.fromInline(`
        exports.handler = async () => {
          const res = await fetch(process.env.INTERNAL_API_URL + '/internal/stock-research/execute', { method: 'POST' });
          if (!res.ok) {
            const body = await res.text();
            throw new Error('Stock research execute failed: ' + res.status + ' ' + body);
          }
        };
      `),
    });

    const schedulerRole = new Role(this, 'StockResearchSchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke the stock research trigger Lambda',
    });

    schedulerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [this.stockResearchFunction.functionArn],
      }),
    );

    this.stockResearchFunction.addPermission('EventBridgeInvoke', {
      principal: new ServicePrincipal('scheduler.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceAccount: this.account,
    });

    // Fires at 8:00 AM ET on weekdays — pre-market, so the Tier 2 research
    // cache is fresh before the first cron job runs at market open
    new CfnSchedule(this, 'StockResearchSchedule', {
      name: 'houdini-stock-research-daily',
      scheduleExpression: 'cron(0 8 ? * MON-FRI *)',
      scheduleExpressionTimezone: 'America/New_York',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: this.stockResearchFunction.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });
  }
}
