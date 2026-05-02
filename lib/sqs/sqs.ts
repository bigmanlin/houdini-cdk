import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

const LAMBDA_TIMEOUT_SECONDS = 300;
const MAX_RECEIVE_COUNT = 3;

export class SqsStack extends Stack {
  public readonly cronJobQueue: Queue;
  public readonly cronJobDlq: Queue;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.cronJobDlq = new Queue(this, 'CronJobDlq', {
      queueName: 'houdini-cron-job-dlq',
      encryption: QueueEncryption.SQS_MANAGED,
    });

    this.cronJobQueue = new Queue(this, 'CronJobQueue', {
      queueName: 'houdini-cron-job-queue',
      encryption: QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(LAMBDA_TIMEOUT_SECONDS * (MAX_RECEIVE_COUNT + 1)),
      deadLetterQueue: {
        queue: this.cronJobDlq,
        maxReceiveCount: MAX_RECEIVE_COUNT,
      },
    });
  }
}
