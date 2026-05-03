import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

const BATCH_SIZE = 1;

interface CronLambdaStackProps extends StackProps {
  cronJobQueue: Queue;
  internalApiUrl: string;
}

export class CronLambdaStack extends Stack {
  public readonly executionFunction: Function;

  constructor(scope: Construct, id: string, props: CronLambdaStackProps) {
    super(scope, id, props);

    const executionRole = new Role(this, 'CronExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.executionFunction = new Function(this, 'CronExecutionFunction', {
      functionName: 'houdini-cron-execution',
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      // Reads the cronJobId from the SQS message and forwards to the ECS /internal route.
      // All trading logic runs in ECS — Lambda is just the SQS bridge.
      code: Code.fromInline(`
        exports.handler = async (event) => {
          const { cronJobId } = JSON.parse(event.Records[0].body);
          const url = process.env.INTERNAL_API_URL + '/internal/cronjob/' + cronJobId + '/execute';
          const res = await fetch(url, { method: 'POST' });
          if (!res.ok) throw new Error('Execute failed: ' + res.status + ' cronJobId=' + cronJobId);
        };
      `),
      timeout: Duration.seconds(30),
      role: executionRole,
      environment: {
        INTERNAL_API_URL: props.internalApiUrl,
      },
    });

    this.executionFunction.addEventSource(
      new SqsEventSource(props.cronJobQueue, { batchSize: BATCH_SIZE }),
    );
  }
}
