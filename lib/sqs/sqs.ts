import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

// How long a claimed message stays hidden before redelivery. Generous so a
// slow run isn't redelivered mid-flight; run-record idempotency guards
// re-execution either way, so this only tunes crash-recovery latency.
const VISIBILITY_TIMEOUT_SECONDS = 1200;
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
      visibilityTimeout: Duration.seconds(VISIBILITY_TIMEOUT_SECONDS),
      deadLetterQueue: {
        queue: this.cronJobDlq,
        maxReceiveCount: MAX_RECEIVE_COUNT,
      },
    });
  }
}
