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
  constructor(scope: Construct, id: string, props: CronLambdaStackProps) {
    super(scope, id, props);

    const executionRole = new Role(this, 'CronExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const fn = new Function(this, 'CronExecutionFunction', {
      functionName: 'houdini-cron-execution',
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.minutes(3),
      role: executionRole,
      environment: {
        INTERNAL_API_URL: props.internalApiUrl,
      },
      code: Code.fromInline(`
        exports.handler = async (event) => {
          const { cronJobId } = JSON.parse(event.Records[0].body);
          const res = await fetch(process.env.INTERNAL_API_URL + '/internal/cronjob/' + cronJobId + '/execute', { method: 'POST' });
          if (!res.ok) throw new Error('Execute failed: ' + res.status + ' cronJobId=' + cronJobId);
        };
      `),
    });

    fn.addEventSource(new SqsEventSource(props.cronJobQueue, { batchSize: BATCH_SIZE }));
  }
}
