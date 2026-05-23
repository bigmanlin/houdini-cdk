import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { join } from 'path';

const BATCH_SIZE = 1;

interface CronLambdaStackProps extends StackProps {
  cronJobQueue: Queue;
  internalApiUrl: string;
}

export class CronLambdaStack extends Stack {
  public readonly executionFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: CronLambdaStackProps) {
    super(scope, id, props);

    const executionRole = new Role(this, 'CronExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.executionFunction = new NodejsFunction(this, 'CronExecutionFunction', {
      functionName: 'houdini-cron-execution',
      runtime: Runtime.NODEJS_22_X,
      entry: join(__dirname, '../../lambda/cron/index.ts'),
      handler: 'handler',
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
